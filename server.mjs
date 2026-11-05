import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = 3000;

const API_KEY = process.env.AZURE_OPENAI_API_KEY;
const MODEL = process.env.AZURE_OPENAI_DEPLOYMENT;

const AZURE_ENDPOINT =
  "https://veteran.services.ai.azure.com/openai/v1/responses";

const MAX_BODY_BYTES = 150_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOTAL_CHARS = 100_000;

if (!API_KEY) {
  console.error("Missing AZURE_OPENAI_API_KEY.");
  process.exit(1);
}

if (!MODEL) {
  console.error("Missing AZURE_OPENAI_DEPLOYMENT.");
  process.exit(1);
}

const EXTRACTION_INSTRUCTIONS = `
You extract an intake draft from a conversation for a veteran support
navigator TEST ENVIRONMENT.

Use only information explicitly provided by the USER.
The assistant's questions, suggestions, and examples are not facts.
Do not infer missing information or eligibility.

Return:
- A concise first-person summary of the user's stated situation and needs.
- Support categories explicitly requested by the user.
- Housing situation only if clearly stated.
- A deadline only if a complete date can be expressed as YYYY-MM-DD.
- City or broad area only if explicitly stated.
- A five-digit ZIP only if explicitly stated in a location context.
- Transportation/access preference only if clearly stated.
- Contact method and contact value only if explicitly stated by the user.

Privacy:
- Exclude unnecessary identifying information from the summary.
- Do not include children's names or ages unless explicitly requested.
- Do not include graphic or traumatic details.
- Respect information the user said not to share.
- Do not invent facts, dates, diagnoses, urgency, or eligibility.

This is a draft that a person will review and correct.
`;

const INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,

  properties: {
    summary: { type: "string" },

    needs: {
      type: "array",
      items: {
        type: "string",
        enum: ["rent", "food", "housing", "work", "medical"]
      }
    },

    housingStatus: {
      type: "string",
      enum: ["", "housed", "at-risk", "seeking", "other"]
    },

    deadline: { type: "string" },
    location: { type: "string" },
    zip: { type: "string" },

    transport: {
      type: "string",
      enum: ["", "transit", "car", "phone", "challenge"]
    },

    contactMethod: {
      type: "string",
      enum: ["", "email", "phone"]
    },

    contactValue: { type: "string" }
  },

  required: [
    "summary",
    "needs",
    "housingStatus",
    "deadline",
    "location",
    "zip",
    "transport",
    "contactMethod",
    "contactValue"
  ]
};

const ALLOWED_ORGANIZATIONS = new Set([
  "demo_riverbend",
  "demo_eastfield",
  "demo_northside",
  "demo_workforce",

  "nj_bcvso",
  "nj_onestop",
  "nj_ssvf",
  "nj_va",
  "nj_vetcenter",
  "nj_food",
  "nj_catholic",
  "nj_gigo",
  "nj_eastorange",
  "nj_newarkbenefits",
  "nj_social",
  "nj_lyons",

  "pgh_vlp",
  "pgh_career",
  "pgh_county",
  "pgh_benefits",
  "pgh_vamc",
  "pgh_vetcenter",
  "pgh_salvation",
  "pgh_wwp",
  "pgh_food",
  "pgh_heinz",

  "sd_vvsd",
  "sd_va",
  "sa_endeavors",
  "sa_bexar"
]);

const ALLOWED_APPLICATION_TYPES = new Set([
  "rent",
  "food",
  "housing",
  "work",
  "medical"
]);

/*
  Simulated submissions live only in memory.
  Restarting the server clears them.
*/
const demoSubmissions = new Map();

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request is too large.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8")
    );
  } catch {
    const error = new Error("Invalid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("A conversation is required.");
  }

  if (messages.length > MAX_MESSAGES) {
    throw new Error("The conversation is too long.");
  }

  let totalChars = 0;

  const validated = messages.map(message => {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      throw new Error("Invalid conversation message.");
    }

    const content = message.content.trim();

    if (!content || content.length > MAX_MESSAGE_CHARS) {
      throw new Error("A conversation message is empty or too long.");
    }

    totalChars += content.length;

    return {
      role: message.role,
      content
    };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw new Error("The conversation is too long.");
  }

  if (!validated.some(message => message.role === "user")) {
    throw new Error("At least one user message is required.");
  }

  return validated;
}

function extractOutputText(data) {
  const parts = [];

  for (const item of data.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function safeCode(value) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_.-]{1,100}$/.test(value)
    ? value
    : "not provided";
}

async function callAzure(messages, useSchema) {
  const response = await fetch(AZURE_ENDPOINT, {
    method: "POST",

    headers: {
      "api-key": API_KEY,
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      model: MODEL,

      instructions: useSchema
        ? EXTRACTION_INSTRUCTIONS
        : EXTRACTION_INSTRUCTIONS +
          "\nReturn only a JSON object with exactly these keys: " +
          "summary, needs, housingStatus, deadline, location, zip, " +
          "transport, contactMethod, contactValue. " +
          "Use empty strings or an empty array when unknown.",

      input: messages,
      max_output_tokens: 1600,

      // This does not guarantee zero provider-side retention.
      store: false,

      ...(useSchema
        ? {
            text: {
              format: {
                type: "json_schema",
                name: "veteran_intake_draft",
                strict: true,
                schema: INTAKE_SCHEMA
              }
            }
          }
        : {})
    }),

    signal: AbortSignal.timeout(45_000)
  });

  if (!response.ok) {
    let details = {};

    try {
      details = await response.json();
    } catch {
      // The response may not contain JSON.
    }

    console.error(
      `Azure AI request failed with HTTP ${response.status}`
    );

    console.error(
      `Azure error code: ${safeCode(details.error?.code)}`
    );

    const error = new Error("Azure AI request failed.");
    error.azureStatus = response.status;
    throw error;
  }

  const data = await response.json();
  const text = extractOutputText(data);

  if (!text) {
    console.error(
      `Azure response contained no output text. Status: ${safeCode(data.status)}`
    );

    throw new Error("Azure returned no output text.");
  }

  return text;
}

function parseDraftText(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    /*
      Limited fallback for models that wrap JSON in a code fence.
      Validation still occurs afterward.
    */
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

    if (!match) {
      throw new Error("The intake draft was not valid JSON.");
    }

    return JSON.parse(match[1]);
  }
}

async function createIntakeDraft(messages) {
  let text;

  try {
    text = await callAzure(messages, true);
  } catch (error) {
    /*
      Some Azure deployments may not support the structured-output
      format. Retry once without the schema only for an HTTP 400.

      The returned JSON is still validated. This fallback does not
      guarantee that every model will produce usable JSON.
    */
    if (error.azureStatus !== 400) {
      throw error;
    }

    console.error(
      "Structured output was rejected. Trying a JSON-text fallback."
    );

    text = await callAzure(messages, false);
  }

  return validateDraft(parseDraftText(text));
}

function validateDraft(draft) {
  const allowedNeeds = new Set([
    "rent",
    "food",
    "housing",
    "work",
    "medical"
  ]);

  const allowedHousing = new Set([
    "",
    "housed",
    "at-risk",
    "seeking",
    "other"
  ]);

  const allowedTransport = new Set([
    "",
    "transit",
    "car",
    "phone",
    "challenge"
  ]);

  const allowedContactMethods = new Set([
    "",
    "email",
    "phone"
  ]);

  if (
    !draft ||
    typeof draft.summary !== "string" ||
    !Array.isArray(draft.needs) ||
    !draft.needs.every(need => allowedNeeds.has(need)) ||
    !allowedHousing.has(draft.housingStatus) ||
    typeof draft.deadline !== "string" ||
    typeof draft.location !== "string" ||
    typeof draft.zip !== "string" ||
    !allowedTransport.has(draft.transport) ||
    !allowedContactMethods.has(draft.contactMethod) ||
    typeof draft.contactValue !== "string"
  ) {
    throw new Error("Invalid intake draft.");
  }

  const zip =
    !draft.zip || /^\d{5}$/.test(draft.zip)
      ? draft.zip
      : "";

  const deadline =
    !draft.deadline || /^\d{4}-\d{2}-\d{2}$/.test(draft.deadline)
      ? draft.deadline
      : "";

  return {
    summary: draft.summary.slice(0, 12000),
    needs: [...new Set(draft.needs)],
    housingStatus: draft.housingStatus,
    deadline,
    location: draft.location.slice(0, 200),
    zip,
    transport: draft.transport,
    contactMethod: draft.contactMethod,
    contactValue: draft.contactValue.slice(0, 200)
  };
}

function validateDemoSubmission(body) {
  if (
    !body ||
    typeof body.organizationId !== "string" ||
    !ALLOWED_ORGANIZATIONS.has(body.organizationId)
  ) {
    throw new Error("Invalid demo organization.");
  }

  if (!["main", "backup"].includes(body.role)) {
    throw new Error("Invalid demo application role.");
  }

  if (
    typeof body.applicationType !== "string" ||
    !ALLOWED_APPLICATION_TYPES.has(body.applicationType)
  ) {
    throw new Error("Invalid demo application type.");
  }

  if (!["email", "phone"].includes(body.contactMethod)) {
    throw new Error("Choose a demo contact method.");
  }

  if (
    typeof body.contactValue !== "string" ||
    !body.contactValue.trim() ||
    body.contactValue.length > 200
  ) {
    throw new Error("Invalid demo contact information.");
  }

  if (
    typeof body.message !== "string" ||
    !body.message.trim() ||
    body.message.length > 8000
  ) {
    throw new Error("Invalid demo message.");
  }

  const contactValue = body.contactValue.trim();

  /*
    Restrict the test environment to obviously fictional contact values.
  */
  if (
    body.contactMethod === "email" &&
    !/^[^\s@]+@[^\s@]+\.invalid$/i.test(contactValue)
  ) {
    throw new Error(
      "Use a fictional test email ending in .invalid."
    );
  }

  if (
    body.contactMethod === "phone" &&
    !contactValue.replace(/\D/g, "").includes("555")
  ) {
    throw new Error(
      "Use a fictional test phone number containing 555."
    );
  }

  return {
    organizationId: body.organizationId,
    role: body.role,
    applicationType: body.applicationType,
    contactMethod: body.contactMethod,
    contactValue,
    message: body.message.trim()
  };
}

function demoStatus(submission) {
  const elapsed = Date.now() - submission.createdAt;

  /*
    Accelerated demo timeline:
    - Immediately: simulated submission.
    - After 3 seconds: simulated receipt.
    - After 10 seconds: simulated follow-up due.

    These are test-system events, not real organization events.
  */

  if (elapsed >= 10_000) {
    return {
      id: submission.id,
      status: "follow_up_due",
      label: "Simulated follow-up due",
      explanation:
        "The test follow-up point has been reached. If a backup was " +
        "selected, its sample application can now be reviewed."
    };
  }

  if (elapsed >= 3_000) {
    return {
      id: submission.id,
      status: "simulated_receipt",
      label: "Simulated receipt",
      explanation:
        "The test system generated a simulated receipt. " +
        "No organization confirmed receipt."
    };
  }

  return {
    id: submission.id,
    status: "simulated_submission",
    label: "Simulated submission recorded",
    explanation:
      "The test system recorded the approved demo submission. " +
      "No real email or application was sent."
  };
}

function isAllowedOrigin(req) {
  const allowed = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
  ]);

  return Boolean(
    req.headers.origin &&
    allowed.has(req.headers.origin)
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${HOST}:${PORT}`
    );

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(
        new URL("./index.html", import.meta.url)
      );

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      });

      res.end(html);
      return;
    }

    const postRoutes = new Set([
      "/api/intake",
      "/api/demo/submit",
      "/api/demo/status"
    ]);

    if (
      req.method === "POST" &&
      postRoutes.has(url.pathname)
    ) {
      const contentType = req.headers["content-type"] || "";

      if (
        !contentType.toLowerCase()
          .startsWith("application/json")
      ) {
        sendJson(res, 415, {
          error: "Expected JSON."
        });

        return;
      }

      if (!isAllowedOrigin(req)) {
        sendJson(res, 403, {
          error: "Request origin is not allowed."
        });

        return;
      }

      const body = await readJsonBody(req);

      if (url.pathname === "/api/intake") {
        let messages;

        try {
          messages = validateMessages(body.messages);
        } catch (error) {
          sendJson(res, 400, {
            error: error.message
          });

          return;
        }

        const draft = await createIntakeDraft(messages);

        sendJson(res, 200, { draft });
        return;
      }

      if (url.pathname === "/api/demo/submit") {
        let submission;

        try {
          submission = validateDemoSubmission(body);
        } catch (error) {
          sendJson(res, 400, {
            error: error.message
          });

          return;
        }

        const id = randomUUID();

        const record = {
          id,
          ...submission,
          recipient:
            `${submission.organizationId}@example.invalid`,
          createdAt: Date.now()
        };

        demoSubmissions.set(id, record);

        sendJson(res, 200, demoStatus(record));
        return;
      }

      if (url.pathname === "/api/demo/status") {
        if (!body || typeof body.id !== "string") {
          sendJson(res, 400, {
            error: "A demo reference is required."
          });

          return;
        }

        const record = demoSubmissions.get(body.id);

        if (!record) {
          sendJson(res, 404, {
            error: "Demo submission not found."
          });

          return;
        }

        sendJson(res, 200, demoStatus(record));
        return;
      }
    }

    sendJson(res, 404, {
      error: "Not found."
    });
  } catch (error) {
    if (error.statusCode) {
      sendJson(res, error.statusCode, {
        error: error.message
      });

      return;
    }

    /*
      Do not log request bodies, API keys, or conversation text.
    */
    console.error("Request failed:", error.name);

    sendJson(res, 500, {
      error:
        "The request could not be completed. Please try again."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Veteran Stability Navigator running at http://${HOST}:${PORT}`
  );
});
