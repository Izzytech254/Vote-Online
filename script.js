let candidates = [];
let hasVoted = false;
let selectedCandidate = null;
let voteQuantity = 1;
let electionClosed = false;
let electionDeadline = new Date("2026-09-25T12:00:00+03:00").getTime();

const candidateGrid = document.querySelector("#candidateGrid");
const voteModal = document.querySelector("#voteModal");
const resultsModal = document.querySelector("#resultsModal");
const voteContent = document.querySelector("#voteContent");
const toast = document.querySelector("#toast");

function updateCountdown() {
  const diff = Math.max(0, electionDeadline - Date.now());
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor(diff % 3600000 / 60000);
  const seconds = Math.floor(diff % 60000 / 1000);
  document.querySelector("#cd-hours").textContent = diff ? String(hours).padStart(2, "0") : "--";
  document.querySelector("#cd-minutes").textContent = diff ? String(minutes).padStart(2, "0") : "--";
  document.querySelector("#cd-seconds").textContent = diff ? String(seconds).padStart(2, "0") : "--";
  if (!diff) setElectionClosed(true);
}
setInterval(updateCountdown, 1000);
updateCountdown();

function setElectionClosed(closed) {
  if (electionClosed === closed) return;
  electionClosed = closed;
  const pill = document.querySelector("#statusPill");
  if (pill) {
    pill.classList.toggle("closed", closed);
    pill.innerHTML = `<i></i> ${closed ? "Polls are closed" : "Voting is open"}`;
  }
  const label = document.querySelector("#countdownLabel");
  if (label) label.textContent = closed ? "Polls closed" : "Polls close in";
  const note = document.querySelector("#votingNote");
  if (note) note.textContent = closed
    ? "Voting has closed. Final standings are available on the results page."
    : "Tap a candidate to learn more, then cast your vote securely.";
  document.querySelectorAll("[data-candidate-id]").forEach(button => { button.disabled = closed; });
}

function renderCandidates() {
  candidateGrid.innerHTML = candidates.map((candidate, index) => `
    <article class="candidate-card">
      <div class="candidate-photo">
        <img src="${candidate.image}" alt="${candidate.name}, ${candidate.role}" />
        <span class="candidate-number">${String(index + 1).padStart(2, "0")}</span>
      </div>
      <h3>${candidate.name}</h3>
      <p>${candidate.role}</p>
      <button type="button" class="vote-button" data-candidate-id="${candidate.id}" ${electionClosed ? "disabled" : ""}><span>✓</span> Vote for ${candidate.name.split(" ")[0]}</button>
    </article>`).join("");
}

function totalVotes() {
  return candidates.reduce((total, candidate) => total + candidate.votes, 0);
}

function showVote(candidate) {
  selectedCandidate = candidate;
  voteQuantity = 1;
  voteContent.innerHTML = `
    <div class="modal-heading">
      <p class="eyebrow"><span></span> Cast your vote</p>
      <h2 id="voteModalTitle">You’re backing a leader.</h2>
      <p>Choose how many votes you would like to cast. Each vote costs KSh 10, paid securely.</p>
    </div>
    <div class="vote-choice">
      <img src="${candidate.image}" alt="${candidate.name}" />
      <div><p>Your candidate</p><h3>${candidate.name}</h3><p>${candidate.role}</p></div>
    </div>
    <label class="pay-label" for="voteQuantity">Number of votes</label>
    <div class="quantity-control" aria-label="Choose number of votes">
      <button type="button" class="quantity-button" id="decreaseVotes" aria-label="Decrease votes">−</button>
      <output id="voteQuantity" aria-live="polite">1</output>
      <button type="button" class="quantity-button" id="increaseVotes" aria-label="Increase votes">+</button>
    </div>
    <p class="quantity-hint">You may choose as many votes as you wish.</p>
    <div class="price-line"><span id="voteSummary">1 verified vote</span><strong id="votePrice">KSh 10.00</strong></div>
    <label class="pay-label" for="voterEmail">Email for receipt (optional)</label>
    <input class="phone-input" id="voterEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address (optional)" />
    <button class="pay-button" id="payButton" type="button">Pay KSh 10 & cast 1 vote</button>
    <p class="pay-page-error" id="payError" hidden></p>
    <p class="payment-note">You’ll complete the payment with M-Pesa or card, and your vote is counted instantly once it succeeds.</p>`;
  voteModal.showModal();
  document.querySelector("#decreaseVotes").addEventListener("click", () => updateVoteQuantity(voteQuantity - 1));
  document.querySelector("#increaseVotes").addEventListener("click", () => updateVoteQuantity(voteQuantity + 1));
  document.querySelector("#payButton").addEventListener("click", submitVote);
  document.querySelector("#voterEmail").focus();
}

function updateVoteQuantity(quantity) {
  voteQuantity = Math.max(1, quantity);
  const label = voteQuantity === 1 ? "vote" : "votes";
  document.querySelector("#voteQuantity").textContent = voteQuantity;
  document.querySelector("#voteSummary").textContent = `${voteQuantity} verified ${label}`;
  document.querySelector("#votePrice").textContent = `KSh ${(voteQuantity * 10).toLocaleString()}.00`;
  document.querySelector("#payButton").textContent = `Pay KSh ${(voteQuantity * 10).toLocaleString()} & cast ${voteQuantity} ${label}`;
  document.querySelector("#decreaseVotes").disabled = voteQuantity === 1;
}

async function submitVote() {
  const emailInput = document.querySelector("#voterEmail");
  const email = emailInput.value.trim();
  const errorBox = document.querySelector("#payError");
  const payButton = document.querySelector("#payButton");
  errorBox.hidden = true;
  if (email && !isValidEmail(email)) {
    errorBox.textContent = "Please enter a valid email address or leave it blank.";
    errorBox.hidden = false;
    emailInput.focus();
    return;
  }
  payButton.disabled = true;
  payButton.textContent = "Preparing payment…";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: selectedCandidate.id,
        quantity: voteQuantity,
        email: email || `voter-${Date.now().toString(36)}@example.com`
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not start your payment.");
    if (payload.checkoutUrl) {
      window.location.assign(payload.checkoutUrl);
      return;
    }
    showPaymentOutcome(payload.order?.status === "paid", payload.order);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    payButton.disabled = false;
    payButton.textContent = `Pay KSh ${(voteQuantity * 10).toLocaleString()} & cast ${voteQuantity} ${voteQuantity === 1 ? "vote" : "votes"}`;
  }
}

function showPaymentOutcome(paid, order) {
  voteContent.innerHTML = paid ? `
    <div class="success-view">
      <div class="success-icon">✓</div>
      <p class="eyebrow" style="justify-content:center"><span></span> Vote recorded</p>
      <h2>Thank you for voting!</h2>
      <p>Your ${order.quantity} ${order.quantity === 1 ? "vote" : "votes"} for <strong>${order.candidateName}</strong> ${order.quantity === 1 ? "has" : "have"} been confirmed and counted.</p>
      <button class="view-results" type="button" id="viewResultsAfterVote">See live results</button>
    </div>` : `
    <div class="success-view">
      <div class="success-icon" style="color:#b3261e">✕</div>
      <p class="eyebrow" style="justify-content:center"><span></span> Payment not confirmed</p>
      <h2>Your vote was not counted.</h2>
      <p>We could not confirm your payment. Please try again or contact the election team.</p>
      <button class="view-results" type="button" id="closeAfterFailure">Close</button>
    </div>`;
  if (paid) {
    hasVoted = true;
    loadElection();
  }
  const next = document.querySelector("#viewResultsAfterVote");
  if (next) next.addEventListener("click", () => { voteModal.close(); openResults(); });
  const close = document.querySelector("#closeAfterFailure");
  if (close) close.addEventListener("click", () => voteModal.close());
}

async function openResults() {
  if (!hasVoted && !electionClosed) {
    showToast("Vote to unlock live results.");
    return;
  }
  try {
    const response = await fetch("/api/results");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load results.");
    document.querySelector("#totalVoteCount").textContent = payload.totalVotes.toLocaleString();
    document.querySelector("#rankingList").innerHTML = payload.results.map((candidate, index) => `
      <div class="ranking-row" data-navigate-results tabindex="0" role="button" aria-label="Open full analytics for ${candidate.name}">
        <span class="rank">0${index + 1}</span>
        <img src="${candidate.image}" alt="" />
        <div><div class="rank-name">${candidate.name}</div><div class="rank-progress"><i style="width:${candidate.percentage}%"></i></div></div>
        <div class="rank-number">${candidate.votes.toLocaleString()}<small>${candidate.percentage}%</small></div>
      </div>`).join("");
    resultsModal.showModal();
    const footer = document.createElement("button");
    footer.type = "button";
    footer.className = "view-results analytics-cta";
    footer.id = "openAnalytics";
    footer.textContent = "Open full analytics page →";
    footer.addEventListener("click", openAnalyticsPage);
    const list = document.querySelector("#rankingList");
    list.appendChild(footer);
  } catch (error) {
    showToast(error.message);
  }
}

function openAnalyticsPage() {
  window.location.assign("/results");
}

resultsModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-navigate-results]")) openAnalyticsPage();
});

resultsModal.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.closest("[data-navigate-results]")) openAnalyticsPage();
});

async function handlePaymentCallback() {
  const reference = new URLSearchParams(window.location.search).get("payment");
  if (!reference) return;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(reference)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not confirm your payment.");
    showPaymentOutcome(payload.order?.status === "paid", payload.order);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadElection() {
  try {
    const response = await fetch("/api/election");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load the election.");
    hasVoted = payload.hasVoted;
    if (payload.electionEndsAt) electionDeadline = new Date(payload.electionEndsAt).getTime();
    setElectionClosed(payload.electionClosed === true);
    updateCountdown();
    candidates = payload.candidates.map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      role: candidate.role,
      image: candidate.image,
      votes: candidate.votes ?? 0
    }));
    renderCandidates();
    if (payload.totalVotes !== null && payload.totalVotes !== undefined) {
      document.querySelector("#totalVoteCount").textContent = totalVotes().toLocaleString();
    }
  } catch (error) {
    candidateGrid.innerHTML = `<p class="section-note">Could not load candidates. Please refresh the page.</p>`;
    showToast(error.message);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2700);
}

candidateGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-candidate-id]");
  if (!button) return;
  if (electionClosed) {
    showToast("Polls have closed. Voting is no longer accepted.");
    return;
  }
  showVote(candidates.find(candidate => candidate.id === Number(button.dataset.candidateId)));
});

document.querySelector("#resultsButton").addEventListener("click", openResults);
document.querySelector("#footerResults").addEventListener("click", openResults);
document.querySelector("#shareButton").addEventListener("click", async () => {
  const shareData = { title: "School Leadership Vote", text: "Vote for your school leader — every vote makes a difference!", url: window.location.href };
  try {
    if (navigator.share) await navigator.share(shareData);
    else { await navigator.clipboard.writeText(window.location.href); showToast("Voting link copied — share it with friends!"); }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Copy this page link to share the election.");
  }
});

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close()));
[voteModal, resultsModal].forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) modal.close(); }));

loadElection();
handlePaymentCallback().finally(() => {
  if (new URLSearchParams(window.location.search).get("payment")) {
    history.replaceState(null, "", window.location.pathname);
  }
});