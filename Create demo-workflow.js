/*
  Veteran Stability Navigator: simulated application workflow

  This file adds a demonstration workflow to the existing application.

  IMPORTANT:
  - No email is sent.
  - No external application is submitted.
  - Recipient addresses use example.invalid.
  - Simulated status is stored in server memory only.
  - Use fictional information in this prototype.
*/

(() => {
  const $demo = selector => document.querySelector(selector);

  const state = {
    organizationId: null,
    role: "main",
    applicationType: "",
    contactMethod: "",
    contactValue: "",
    message: "",
    approvedSnapshot: null,
    submissionId: null,
    pollTimer: null
  };

  const APPLICATION_LABELS = {
    rent: "Rent or bills assistance",
    food: "Food assistance",
    housing: "Housing assistance",
    work: "Employment or training",
    medical: "Healthcare support"
  };

  const APPLICATION_ORDER = [
    "rent",
    "food",
    "housing",
    "work",
    "medical"
  ];

  const step = $demo("#step-4");

  if (!step) {
    console.error("Demo workflow could not find the action-plan screen.");
    return;
  }

  /*
    Hide the earlier self-managed tracker and sharing preview.

    The new demo workflow provides a clearer review, submission,
    and follow-up process. The original page remains in the file.
  */
  const oldTracker = $demo("#tracker-status")?.closest(".panel");
  const oldSharingPreview = $demo("#sharing-preview")?.closest(".panel");
  const oldSharingChoices =
    $demo('input[name="share"]')?.closest("fieldset");

  if (oldTracker) oldTracker.hidden = true;
  if (oldSharingPreview) oldSharingPreview.hidden = true;
  if (oldSharingChoices) oldSharingChoices.hidden = true;

  const workflow = document.createElement("section");
  workflow.className = "panel no-print";
  workflow.id = "demo-workflow";

  /*
    This HTML is static application markup. User and organization
    information is inserted later using textContent or input values.
  */
  workflow.innerHTML = `
    <h3>Your application and follow-up</h3>

    <div class="notice">
      <strong>Test environment</strong>
      This is a simulation. No email is sent and no real application is
      submitted. Use fictional information only.
    </div>

    <p>
      We’ll prepare a sample application and message using the information
      you already shared. You can review everything before approving it.
    </p>

    <div id="demo-empty" class="status" hidden></div>

    <div id="demo-form-area" hidden>
      <p id="demo-destination"></p>

      <label class="field-label" for="demo-application-type">
        What kind of help should this application request?
      </label>

      <select id="demo-application-type">
        <option value="">Choose a type of support</option>
        <option value="rent">Rent or bills assistance</option>
        <option value="food">Food assistance</option>
        <option value="housing">Housing assistance</option>
        <option value="work">Employment or training</option>
        <option value="medical">Healthcare support</option>
      </select>

      <p class="small">
        This is a sample form, not the organization’s actual application.
        The organization may offer different services or have different
        requirements.
      </p>

      <label class="field-label" for="demo-contact-method">
        How should the demo organization respond?
      </label>

      <select id="demo-contact-method">
        <option value="">Choose a contact method</option>
        <option value="email">Email</option>
        <option value="phone">Phone</option>
      </select>

      <label class="field-label" for="demo-contact-value">
        Fictional test contact information
      </label>

      <input
        type="text"
        id="demo-contact-value"
        maxlength="200"
        placeholder="Use a fictional email address or phone number"
      >

      <label class="field-label" for="demo-message">
        Your editable demo message
      </label>

      <textarea
        id="demo-message"
        maxlength="8000"
        placeholder="Write or edit the message you would like reviewed."
      ></textarea>

      <p class="small">
        We start with your editable summary. Check the message and remove
        anything you do not want included.
      </p>

      <div class="actions">
        <button type="button" id="demo-review">
          Review my demo application
        </button>
      </div>

      <p
        id="demo-form-status"
        class="status"
        aria-live="polite"
      ></p>
    </div>

    <div id="demo-review-area" hidden>
      <h3>Review before approving</h3>

      <p class="small">
        Check the destination, contact information, and message. Nothing
        will be sent to a real organization.
      </p>

      <div id="demo-review-content" class="organization"></div>

      <div class="actions">
        <button type="button" id="demo-approve">
          Approve simulated submission
        </button>

        <button type="button" id="demo-edit" class="secondary">
          Make changes
        </button>
      </div>

      <p
        id="demo-submit-status"
        class="status"
        aria-live="polite"
      ></p>
    </div>

    <div id="demo-tracking-area" hidden>
      <h3>Simulated follow-up</h3>

      <p class="small">
        These statuses are generated by the test system. They are not
        confirmations from an organization.
      </p>

      <div id="demo-tracking-content" class="organization"></div>

      <div class="actions">
        <button
          type="button"
          id="demo-prepare-backup"
          class="secondary"
          hidden
        >
          Prepare a demo application for my backup
        </button>
      </div>

      <p class="small">
        This test server keeps the simulated status in memory. Restarting
        the server clears it. The browser must remain open to see updates.
      </p>
    </div>
  `;

  /*
    Insert the new workflow after the selected-organizations panel.
  */
  const selectedOrganizationsPanel =
    $demo("#plan-organizations")?.closest(".panel");

  if (selectedOrganizationsPanel) {
    selectedOrganizationsPanel.after(workflow);
  } else {
    step.appendChild(workflow);
  }

  const formArea = $demo("#demo-form-area");
  const reviewArea = $demo("#demo-review-area");
  const trackingArea = $demo("#demo-tracking-area");

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function resetDemoState() {
    stopPolling();

    state.organizationId = null;
    state.role = "main";
    state.applicationType = "";
    state.contactMethod = "";
    state.contactValue = "";
    state.message = "";
    state.approvedSnapshot = null;
    state.submissionId = null;

    formArea.hidden = true;
    reviewArea.hidden = true;
    trackingArea.hidden = true;

    $demo("#demo-empty").hidden = true;
    $demo("#demo-empty").textContent = "";
    $demo("#demo-form-status").textContent = "";
    $demo("#demo-submit-status").textContent = "";
    $demo("#demo-review-content").replaceChildren();
    $demo("#demo-tracking-content").replaceChildren();
    $demo("#demo-prepare-backup").hidden = true;
  }

  function currentOrganization(role) {
    const id =
      role === "backup"
        ? backupOrganizationId
        : mainOrganizationId;

    return getOrganization(id);
  }

  function selectedApplicationType() {
    const needs = selectedNeeds();

    return APPLICATION_ORDER.find(
      type => needs.includes(type)
    ) || "";
  }

  function demoRecipient(organizationId) {
    /*
      example.invalid is deliberately non-deliverable.
      The server independently constructs the same type of recipient.
    */
    return `${organizationId}@example.invalid`;
  }

  function defaultMessage() {
    const summary = $demo("#summary").value.trim();

    if (!summary) {
      return "";
    }

    return summary;
  }

  function prepareForOrganization(role) {
    const org = currentOrganization(role);

    if (!org) {
      resetDemoState();

      $demo("#demo-empty").hidden = false;
      $demo("#demo-empty").textContent =
        role === "backup"
          ? "No backup organization is selected. Go back to Support options to choose one."
          : "Choose a main organization in Support options before preparing an application.";

      return;
    }

    stopPolling();

    state.organizationId = org.id;
    state.role = role;
    state.applicationType = selectedApplicationType();

    /*
      Preserve fictional contact information when preparing a backup,
      but require a separate review and approval.
    */
    const previousContactMethod = state.contactMethod;
    const previousContactValue = state.contactValue;

    state.message = defaultMessage();
    state.approvedSnapshot = null;
    state.submissionId = null;

    $demo("#demo-empty").hidden = true;
    $demo("#demo-empty").textContent = "";

    $demo("#demo-destination").textContent =
      `Preparing a simulated ${role} application for: ${org.name}`;

    $demo("#demo-application-type").value =
      state.applicationType;

    $demo("#demo-contact-method").value =
      previousContactMethod;

    $demo("#demo-contact-value").value =
      previousContactValue;

    $demo("#demo-message").value =
      state.message;

    $demo("#demo-form-status").textContent = "";
    $demo("#demo-submit-status").textContent = "";
    $demo("#demo-review-content").replaceChildren();
    $demo("#demo-tracking-content").replaceChildren();
    $demo("#demo-prepare-backup").hidden = true;

    formArea.hidden = false;
    reviewArea.hidden = true;
    trackingArea.hidden = true;
  }

  function safeText(value, maxLength) {
    return typeof value === "string"
      ? value.trim().slice(0, maxLength)
      : "";
  }

  function getCurrentForm() {
    return {
      organizationId: state.organizationId,
      applicationType: $demo("#demo-application-type").value,
      contactMethod: $demo("#demo-contact-method").value,
      contactValue: safeText(
        $demo("#demo-contact-value").value,
        200
      ),
      message: safeText(
        $demo("#demo-message").value,
        8000
      )
    };
  }

  function validateForm(form) {
    if (!form.organizationId) {
      return "Please choose an organization first.";
    }

    if (!APPLICATION_LABELS[form.applicationType]) {
      return "Please choose the type of support for this demo application.";
    }

    if (!["email", "phone"].includes(form.contactMethod)) {
      return "Please choose how the demo organization should respond.";
    }

    if (!form.contactValue) {
      return "Please add fictional test contact information.";
    }

    if (
      form.contactMethod === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactValue)
    ) {
      return "Please enter a valid-looking fictional email address.";
    }

    if (
      form.contactMethod === "phone" &&
      form.contactValue.replace(/\D/g, "").length < 7
    ) {
      return "Please enter a valid-looking fictional phone number.";
    }

    if (!form.message) {
      return "Please add or review the message for the demo application.";
    }

    return "";
  }

  function addReviewLine(container, label, value) {
    const paragraph = document.createElement("p");
    const strong = document.createElement("strong");

    strong.textContent = label + ": ";

    paragraph.append(
      strong,
      document.createTextNode(value || "Not provided")
    );

    container.appendChild(paragraph);
  }

  function showReview() {
    const form = getCurrentForm();
    const error = validateForm(form);

    if (error) {
      $demo("#demo-form-status").textContent = error;
      return;
    }

    const org = getOrganization(form.organizationId);

    if (!org) {
      $demo("#demo-form-status").textContent =
        "The selected organization is no longer available.";
      return;
    }

    state.applicationType = form.applicationType;
    state.contactMethod = form.contactMethod;
    state.contactValue = form.contactValue;
    state.message = form.message;

    /*
      Save the exact reviewed values. If the person changes the form,
      approval must be reviewed again.
    */
    state.approvedSnapshot = JSON.stringify(form);

    const container = $demo("#demo-review-content");
    container.replaceChildren();

    addReviewLine(container, "Organization", org.name);

    addReviewLine(
      container,
      "Simulated recipient",
      demoRecipient(org.id)
    );

    addReviewLine(
      container,
      "Application type",
      APPLICATION_LABELS[form.applicationType]
    );

    addReviewLine(
      container,
      "Response method",
      form.contactMethod === "email" ? "Email" : "Phone"
    );

    addReviewLine(
      container,
      "Fictional test contact",
      form.contactValue
    );

    addReviewLine(container, "Message", form.message);

    const warning = document.createElement("p");
    warning.className = "small";
    warning.textContent =
      "Simulation only: this recipient is not deliverable, and no real " +
      "organization will receive the information.";

    container.appendChild(warning);

    $demo("#demo-form-status").textContent = "";
    $demo("#demo-submit-status").textContent = "";

    formArea.hidden = true;
    reviewArea.hidden = false;
    trackingArea.hidden = true;

    $demo("#demo-approve").focus();
  }

  async function api(path, payload) {
    const response = await fetch(path, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || "The demo service could not complete the request."
      );
    }

    return data;
  }

  async function submitSimulation() {
    const form = getCurrentForm();

    if (!state.approvedSnapshot) {
      $demo("#demo-submit-status").textContent =
        "Please review the demo application first.";
      return;
    }

    if (JSON.stringify(form) !== state.approvedSnapshot) {
      $demo("#demo-submit-status").textContent =
        "The application changed. Please review it again.";
      return;
    }

    const button = $demo("#demo-approve");
    button.disabled = true;

    $demo("#demo-submit-status").textContent =
      "Recording the simulated submission...";

    try {
      const result = await api("/api/demo/referrals", form);

      state.submissionId = result.id;

      reviewArea.hidden = true;
      trackingArea.hidden = false;

      $demo("#demo-submit-status").textContent = "";

      renderTracking(result);
      startPolling();
    } catch (error) {
      $demo("#demo-submit-status").textContent =
        error.message ||
        "The simulated submission could not be recorded.";
    } finally {
      button.disabled = false;
    }
  }

  function renderTracking(result) {
    const container = $demo("#demo-tracking-content");
    container.replaceChildren();

    const org = getOrganization(state.organizationId);

    addReviewLine(
      container,
      "Organization",
      org ? org.name : "Selected organization"
    );

    addReviewLine(
      container,
      "Demo reference",
      result.id
    );

    addReviewLine(
      container,
      "Status",
      result.label
    );

    const explanation = document.createElement("p");
    explanation.textContent = result.explanation;
    container.appendChild(explanation);

    const warning = document.createElement("p");
    warning.className = "small";
    warning.textContent =
      "No real email or application was sent. This status is generated " +
      "by the test server.";

    container.appendChild(warning);

    const hasBackup =
      state.role === "main" &&
      Boolean(currentOrganization("backup"));

    $demo("#demo-prepare-backup").hidden =
      result.status !== "follow_up_due" || !hasBackup;
  }

  async function refreshTracking() {
    if (!state.submissionId) return;

    try {
      const result = await api(
        "/api/demo/referrals/status",
        { id: state.submissionId }
      );

      renderTracking(result);

      if (result.status === "follow_up_due") {
        stopPolling();
      }
    } catch {
      stopPolling();

      const container = $demo("#demo-tracking-content");
      container.replaceChildren();

      const message = document.createElement("p");
      message.textContent =
        "The demo status could not be retrieved. The test server may " +
        "have restarted. No real referral was sent.";

      container.appendChild(message);
    }
  }

  function startPolling() {
    stopPolling();

    state.pollTimer = setInterval(
      refreshTracking,
      2000
    );
  }

  /*
    Entering the action plan automatically prepares the main
    demo application. No submission occurs here.
  */
  $demo("#to-plan").addEventListener("click", () => {
    const main = currentOrganization("main");

    if (!main) {
      prepareForOrganization("main");
      return;
    }

    /*
      Keep an active demo submission visible when returning to the
      action plan for the same selected main organization.
    */
    if (
      state.submissionId &&
      state.organizationId === main.id &&
      state.role === "main"
    ) {
      formArea.hidden = true;
      reviewArea.hidden = true;
      trackingArea.hidden = false;
      refreshTracking();
      return;
    }

    prepareForOrganization("main");
  });

  $demo("#demo-review").addEventListener("click", showReview);

  $demo("#demo-edit").addEventListener("click", () => {
    state.approvedSnapshot = null;
    reviewArea.hidden = true;
    formArea.hidden = false;
    $demo("#demo-message").focus();
  });

  $demo("#demo-approve").addEventListener(
    "click",
    submitSimulation
  );

  $demo("#demo-prepare-backup").addEventListener("click", () => {
    /*
      A different recipient requires a fresh review and approval.
    */
    prepareForOrganization("backup");
  });

  $demo("#reset").addEventListener("click", resetDemoState);
  $demo("#begin").addEventListener("click", resetDemoState);
  $demo("#start-fresh").addEventListener("click", resetDemoState);

  /*
    Browser-local save in the existing app does not save the demo
    submission ID or prepared form.
  */
  const savePanel = $demo("#save-progress")?.closest(".panel");

  if (savePanel) {
    const note = document.createElement("p");
    note.className = "small";
    note.textContent =
      "The simulated application, contact details, and demo status are " +
      "not included in browser-saved progress.";

    savePanel.appendChild(note);
  }
})();
