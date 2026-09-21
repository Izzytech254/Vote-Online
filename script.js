const candidates = [
  { id: 1, name: "Mr Ismael Omwando", role: "School Administrator Candidate", votes: 0, image: "photos/Mr Ismael Omwando.jpeg" },
  { id: 2, name: "Ogendo Felix", role: "School Administrator Candidate", votes: 0, image: "photos/Ogendo Felix.jpeg" },
  { id: 3, name: "Onesmus Anyimu", role: "School Administrator Candidate", votes: 0, image: "photos/Onesmus Anyimu.jpeg" },
  { id: 4, name: "Njeri Nyambura", role: "School Administrator Candidate", votes: 0, image: "photos/Candidate 04 - stock photo.jpeg" },
  { id: 5, name: "Madam Ruth Kipng'eno", role: "School Administrator Candidate", votes: 0, image: "photos/Candidate 05 - stock photo.jpeg" }
];

const candidateGrid = document.querySelector("#candidateGrid");
const voteModal = document.querySelector("#voteModal");
const resultsModal = document.querySelector("#resultsModal");
const voteContent = document.querySelector("#voteContent");
const toast = document.querySelector("#toast");
let selectedCandidate = null;
let voteQuantity = 1;

function renderCandidates() {
  candidateGrid.innerHTML = candidates.map((candidate, index) => `
    <article class="candidate-card">
      <div class="candidate-photo">
        <img src="${candidate.image}" alt="${candidate.name}, ${candidate.role}" />
        <span class="candidate-number">${String(index + 1).padStart(2, "0")}</span>
      </div>
      <h3>${candidate.name}</h3>
      <p>${candidate.role}</p>
      <button type="button" class="vote-button" data-candidate-id="${candidate.id}"><span>✓</span> Vote for ${candidate.name.split(" ")[0]}</button>
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
      <p>Choose how many votes you would like to cast. Each vote costs KSh 10.</p>
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
    <label class="pay-label">Choose payment method</label>
    <div class="payment-methods">
      <label class="payment-method"><input type="radio" name="payment" checked /> M-Pesa</label>
      <label class="payment-method"><input type="radio" name="payment" /> Card</label>
    </div>
    <label class="pay-label" for="phoneNumber">M-Pesa phone number</label>
    <input class="phone-input" id="phoneNumber" inputmode="tel" placeholder="e.g. 0712 345 678" aria-label="M-Pesa phone number" />
    <button class="pay-button" id="payButton" type="button">Pay KSh 10 & cast 1 vote</button>
    <p class="payment-note">You will receive a secure payment prompt on your phone.</p>`;
  voteModal.showModal();
  document.querySelector("#decreaseVotes").addEventListener("click", () => updateVoteQuantity(voteQuantity - 1));
  document.querySelector("#increaseVotes").addEventListener("click", () => updateVoteQuantity(voteQuantity + 1));
  document.querySelector("#payButton").addEventListener("click", completeVote);
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

function completeVote() {
  const phone = document.querySelector("#phoneNumber").value.trim();
  if (phone && phone.replace(/\D/g, "").length < 9) {
    showToast("Please enter a valid phone number.");
    return;
  }
  selectedCandidate.votes += voteQuantity;
  const voteLabel = voteQuantity === 1 ? "vote" : "votes";
  const voteVerb = voteQuantity === 1 ? "has" : "have";
  const amount = (voteQuantity * 10).toLocaleString();
  voteContent.innerHTML = `
    <div class="success-view">
      <div class="success-icon">✓</div>
      <p class="eyebrow" style="justify-content:center"><span></span> Vote recorded</p>
      <h2>Thank you for voting!</h2>
      <p>Your ${voteQuantity} ${voteLabel} for <strong>${selectedCandidate.name}</strong> ${voteVerb} been recorded. KSh ${amount} has been added to your payment total.</p>
      <button class="view-results" type="button" id="viewResultsAfterVote">See live results</button>
    </div>`;
  document.querySelector("#viewResultsAfterVote").addEventListener("click", () => {
    voteModal.close();
    openResults();
  });
}

function openResults() {
  const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
  const total = totalVotes();
  const percentages = percentageShares(sorted.map(candidate => candidate.votes), total);
  document.querySelector("#totalVoteCount").textContent = total.toLocaleString();
  document.querySelector("#rankingList").innerHTML = sorted.map((candidate, index) => {
    const percentage = percentages[index];
    return `<div class="ranking-row">
      <span class="rank">0${index + 1}</span>
      <img src="${candidate.image}" alt="" />
      <div><div class="rank-name">${candidate.name}</div><div class="rank-progress"><i style="width:${percentage}%"></i></div></div>
      <div class="rank-number">${candidate.votes.toLocaleString()}<small>${percentage}%</small></div>
    </div>`;
  }).join("");
  resultsModal.showModal();
}

function percentageShares(votes, total) {
  if (!total || votes.length === 0) return votes.map(() => 0);
  const raw = votes.map(vote => (vote / total) * 100);
  const shares = raw.map(value => Math.floor(value));
  let remainder = 100 - shares.reduce((sum, value) => sum + value, 0);
  const fractional = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i++) shares[fractional[i].index] += 1;
  return shares;
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

renderCandidates();
