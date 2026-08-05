import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- state ----------------
let currentUser = null;
let isAdmin = false;
let restaurants = [];   // [{id, name, address, lat, lng, ...}]
let reviews = [];        // [{id, restaurantId, userId, userName, rating, comment}]
let users = [];          // [{id (uid), email, displayName}]
let map = null;
let markers = new Map(); // restaurantId -> leaflet marker
let activeRestaurantId = null;
let activeUserId = null;
let panelMode = null; // 'detail' | 'add' | 'account' | 'user'

const CLUB_POSITIONS = [
  'Grillmaster General',
  'Chief Condiment Officer',
  'VP of Bun Quality',
  'Head of Pickle Relations',
  'Director of Extra Cheese',
  'Secretary of Secret Sauce',
  'Minister of Medium Rare',
  'Chairperson of Combo Meals',
  'Ambassador to Ketchup',
  'Senior Fry Analyst',
  'Chief Napkin Officer',
  'Director of Onion Ring Affairs',
  'Head Bun Toaster',
  'Vice President of Toppings',
  'Chief Sesame Seed Inspector',
  'Milkshake Sommelier',
  'Regional Manager, Sauce Division',
  'Keeper of the Secret Menu',
  'Chief Doneness Officer',
  'Lead Napkin Distribution Strategist',
  'Director of Char Marks',
  'Chief Lettuce Crispness Officer',
  'VP of Bacon Integration',
  'Head of Ranch Diplomacy',
  'Executive Bun Softness Auditor',
  'Chief Flipping Officer',
  'Minister of Melt Consistency',
  'Senior Squeeze Bottle Technician',
  'Director of Combo Upsizing',
  'Chief Patty Symmetry Officer',
  'VP of Drive-Thru Relations',
  'Head Curator, Wall of Fame',
  'Chief Spice Level Regulator',
  'Sultan of Special Sauce',
  'Assistant to the Grillmaster',
  'Director of Late-Night Cravings',
  'Chief Value Meal Strategist',
  'Guardian of the Deep Fryer',
  'Vice Chair, Toothpick Committee',
  'Head of Booth Seating Logistics',
  'Chief Onion Breath Ambassador',
  'Director of Bun-to-Patty Ratio',
  'Senior Ketchup Packet Wrangler',
  'Chief Mustard Diplomat',
  'Head of Crouton-Adjacent Affairs',
  'VP of Second Helpings',
  'Minister of Rare Toppings',
  'Chief Combo Meal Cartographer',
  'Director of Grease Stain Prevention',
  'Executive Ice Cube Officer',
  'Chief Bun Seed Density Officer'
];

// ---------------- DOM ----------------
const el = (id) => document.getElementById(id);
const loginScreen = el('login-screen');
const appShell = el('app-shell');
const topbar = el('topbar');
const userChip = el('user-chip');
const entryList = el('entry-list');
const emptyState = el('empty-state');
const leaderboardView = el('leaderboard-view');
const addEntryBtn = el('add-entry-btn');
const panelOverlay = el('panel-overlay');
const panelBody = el('panel-body');

el('tab-places').addEventListener('click', () => setSidebarTab('places'));
el('tab-leaderboard').addEventListener('click', () => setSidebarTab('leaderboard'));

function setSidebarTab(tab) {
  el('tab-places').classList.toggle('active', tab === 'places');
  el('tab-leaderboard').classList.toggle('active', tab === 'leaderboard');
  el('places-view').classList.toggle('hidden', tab !== 'places');
  leaderboardView.classList.toggle('hidden', tab !== 'leaderboard');
}

// ---------------- mobile sidebar drawer ----------------
const sidebarEl = el('sidebar');
const sidebarBackdrop = el('sidebar-backdrop');
function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarBackdrop.classList.add('open');
}
function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
}
el('menu-toggle').addEventListener('click', openSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

// ---------------- auth ----------------
el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  const errBox = el('login-error');
  errBox.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errBox.textContent = friendlyAuthError(err);
  }
});

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return "That email or password doesn't match an account. Ask the admin to double-check your login.";
  }
  if (code.includes('too-many-requests')) return "Too many attempts — wait a bit and try again.";
  return "Couldn't log in. Try again in a moment.";
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  isAdmin = !!user && ADMIN_EMAILS.includes(user.email);
  if (user) {
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    topbar.classList.remove('hidden');
    userChip.innerHTML = `
      <span class="email">${escapeHtml(user.email)}${isAdmin ? ' · admin' : ''}</span>
      <button class="btn ghost small" id="account-btn">Account</button>
      <button class="btn ghost small" id="logout-btn-2">Log out</button>
    `;
    el('account-btn').addEventListener('click', openAccountPanel);
    el('logout-btn-2').addEventListener('click', () => signOut(auth));
    addEntryBtn.classList.toggle('hidden', !isAdmin);
    initMapIfNeeded();
    subscribeData();
    ensureUserProfile(user);
  } else {
    loginScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    topbar.classList.add('hidden');
    closePanel();
  }
});

// ---------------- Firestore subscriptions ----------------
async function ensureUserProfile(user) {
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists() || !snap.data().clubPosition) {
      const position = CLUB_POSITIONS[Math.floor(Math.random() * CLUB_POSITIONS.length)];
      await setDoc(ref, { email: user.email, clubPosition: position }, { merge: true });
    } else {
      await setDoc(ref, { email: user.email }, { merge: true });
    }
  } catch (err) { /* non-critical, ignore */ }
}

function subscribeData() {
  onSnapshot(query(collection(db, 'restaurants'), orderBy('name')), (snap) => {
    restaurants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    renderLeaderboard();
    refreshOpenPanel();
  });

  onSnapshot(collection(db, 'reviews'), (snap) => {
    reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    renderLeaderboard();
    refreshOpenPanel();
  });

  onSnapshot(collection(db, 'users'), (snap) => {
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
    renderLeaderboard();
    refreshOpenPanel();
  });
}

function refreshOpenPanel() {
  if (panelMode === 'detail' && activeRestaurantId) renderDetailPanel(activeRestaurantId);
  if (panelMode === 'account') openAccountPanel();
  if (panelMode === 'user' && activeUserId) openUserProfilePanel(activeUserId);
}

function displayNameFor(userId, fallback) {
  const u = users.find(x => x.id === userId);
  return (u && u.displayName) ? u.displayName : (fallback || 'Someone');
}
function positionFor(userId) {
  const u = users.find(x => x.id === userId);
  return (u && u.clubPosition) || null;
}

// ---------------- helpers ----------------
function reviewsFor(restaurantId) {
  return reviews.filter(r => r.restaurantId === restaurantId);
}
function avgRating(restaurantId) {
  const rs = reviewsFor(restaurantId);
  if (!rs.length) return null;
  return rs.reduce((s, r) => s + r.rating, 0) / rs.length;
}
function meterHtml(rating, max = 10) {
  const pct = Math.max(0, Math.min(100, (rating / max) * 100));
  return `<div class="meter-row">
    <div class="burger-meter" style="--pct:${pct}%"></div>
    <div class="meter-num">${rating.toFixed(1)}<span class="meter-max">/10</span></div>
  </div>`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function sliderField(cat, label, value) {
  const v = (value ?? 5.0);
  return `
    <div class="field">
      <label>${label}</label>
      <div class="slider-row">
        <input type="range" min="1" max="10" step="0.1" value="${v}" data-cat="${cat}" class="burger-slider">
        <span class="slider-num" data-cat="${cat}">${Number(v).toFixed(1)}</span>
      </div>
    </div>
  `;
}

// ---------------- sidebar list ----------------
function renderEntryList() {
  entryList.innerHTML = '';
  if (!restaurants.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  restaurants.forEach(r => {
    const avg = avgRating(r.id);
    const count = reviewsFor(r.id).length;
    const card = document.createElement('div');
    card.className = 'entry-card' + (r.id === activeRestaurantId ? ' active' : '');
    card.innerHTML = `
      <h3>${escapeHtml(r.name)}</h3>
      <div class="addr">${escapeHtml(r.address || '')}</div>
      ${avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet</div>'}
      <div class="entry-meta-row">
        <span class="count-tag">${count} review${count === 1 ? '' : 's'}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      openDetailPanel(r.id);
      if (markers.has(r.id)) {
        map.flyTo(markers.get(r.id).getLatLng(), 15, { duration: 0.6 });
        markers.get(r.id).openPopup();
      }
      closeSidebar();
    });
    entryList.appendChild(card);
  });
}

// ---------------- leaderboard ----------------
function renderLeaderboard() {
  const ranked = restaurants
    .map(r => ({ r, avg: avgRating(r.id), count: reviewsFor(r.id).length }))
    .filter(x => x.avg !== null)
    .sort((a, b) => b.avg - a.avg);

  const restaurantsHtml = ranked.length ? ranked.map((x, i) => `
    <li class="lb-item" data-restaurant="${x.r.id}">
      <span class="lb-rank">${i + 1}</span>
      <div class="lb-main">
        <div class="lb-name">${escapeHtml(x.r.name)}</div>
        <div class="lb-sub">${x.count} review${x.count === 1 ? '' : 's'}</div>
      </div>
      <span class="lb-score">${x.avg.toFixed(1)}</span>
    </li>
  `).join('') : `<div class="count-tag lb-empty">No rated places yet.</div>`;

  const userStats = users.map(u => {
    const rs = reviews.filter(rv => rv.userId === u.id);
    const avg = rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null;
    return { id: u.id, name: displayNameFor(u.id, u.email ? u.email.split('@')[0] : 'Someone'), count: rs.length, avg };
  }).filter(u => u.count > 0).sort((a, b) => b.count - a.count);

  const usersHtml = userStats.length ? userStats.map((u, i) => `
    <li class="lb-item" data-user="${u.id}">
      <span class="lb-rank">${i + 1}</span>
      <div class="lb-main">
        <div class="lb-name">${escapeHtml(u.name)}</div>
        <div class="lb-sub">${u.count} review${u.count === 1 ? '' : 's'} · Burger Score ${u.avg.toFixed(1)}</div>
      </div>
    </li>
  `).join('') : `<div class="count-tag lb-empty">No reviews yet.</div>`;

  leaderboardView.innerHTML = `
    <div class="lb-section">
      <h3 class="lb-heading">Top Burgers</h3>
      <ol class="lb-list">${restaurantsHtml}</ol>
    </div>
    <div class="lb-section">
      <h3 class="lb-heading">Club Leaderboard</h3>
      <ol class="lb-list">${usersHtml}</ol>
    </div>
  `;

  leaderboardView.querySelectorAll('[data-restaurant]').forEach(li => {
    li.addEventListener('click', () => {
      const id = li.dataset.restaurant;
      openDetailPanel(id);
      if (markers.has(id)) {
        map.flyTo(markers.get(id).getLatLng(), 15, { duration: 0.6 });
        markers.get(id).openPopup();
      }
      closeSidebar();
    });
  });
  leaderboardView.querySelectorAll('[data-user]').forEach(li => {
    li.addEventListener('click', () => {
      openUserProfilePanel(li.dataset.user);
      closeSidebar();
    });
  });
}

// ---------------- panel: user profile ----------------
function openUserProfilePanel(userId) {
  activeRestaurantId = null;
  activeUserId = userId;
  panelMode = 'user';
  const u = users.find(x => x.id === userId);
  const name = displayNameFor(userId, u && u.email ? u.email.split('@')[0] : 'Someone');
  const position = (u && u.clubPosition) || 'Member';
  const myReviews = reviews.filter(rv => rv.userId === userId);
  const burgerScore = myReviews.length ? myReviews.reduce((s, r) => s + r.rating, 0) / myReviews.length : null;

  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>${escapeHtml(name)}</h2>
      <div class="sub">${escapeHtml(position)}</div>

      <div class="burger-score-box">
        <div>
          <div class="bs-label">Burger Score</div>
          <div class="bs-value">${burgerScore !== null ? burgerScore.toFixed(1) : '—'}${burgerScore !== null ? '<span class="meter-max">/10</span>' : ''}</div>
        </div>
        <div class="bs-count">${myReviews.length} review${myReviews.length === 1 ? '' : 's'}</div>
      </div>

      <hr style="border:none;border-top:1px dashed var(--line);margin:18px 0;">

      <div class="review-list">
        ${myReviews.length ? myReviews.map(rv => {
          const restaurant = restaurants.find(r => r.id === rv.restaurantId);
          return `
            <div class="review-item">
              <div class="who">
                <span class="who-name">${escapeHtml(restaurant ? restaurant.name : 'Unknown place')}</span>
                <span>${rv.rating.toFixed(1)}/10</span>
              </div>
              <div class="breakdown">
                Burger ${Number(rv.burgerRating ?? rv.rating).toFixed(1)} ·
                Sides/Drinks ${Number(rv.sidesRating ?? rv.rating).toFixed(1)} ·
                Establishment ${Number(rv.establishmentRating ?? rv.rating).toFixed(1)}
              </div>
              ${rv.comment ? `<div class="comment">${escapeHtml(rv.comment)}</div>` : ''}
            </div>
          `;
        }).join('') : `<div class="count-tag">No reviews yet.</div>`}
      </div>
    </div>
  `;
  panelOverlay.classList.add('open');
  el('panel-close').addEventListener('click', closePanel);
}

// ---------------- map ----------------
function initMapIfNeeded() {
  if (map) return;
  map = L.map('map', { zoomControl: true }).setView([40.7128, -74.0060], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

function burgerDivIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="burger-pin"><span>🍔</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26]
  });
}

function renderMarkers() {
  if (!map) return;
  const seen = new Set();
  restaurants.forEach(r => {
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
    seen.add(r.id);
    const popupHtml = buildPopupHtml(r);
    if (markers.has(r.id)) {
      const m = markers.get(r.id);
      m.setLatLng([r.lat, r.lng]);
      m.setPopupContent(popupHtml);
    } else {
      const m = L.marker([r.lat, r.lng], { icon: burgerDivIcon() }).addTo(map);
      m.bindPopup(popupHtml);
      m.on('click', () => openDetailPanel(r.id));
      markers.set(r.id, m);
    }
  });
  // remove stale markers
  for (const [id, m] of markers.entries()) {
    if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); }
  }
}

function buildPopupHtml(r) {
  const rs = reviewsFor(r.id);
  const avg = avgRating(r.id);
  const rowsHtml = rs.length
    ? rs.map(rv => `<div class="popup-review-row">
        <span>${escapeHtml(displayNameFor(rv.userId, rv.userName))}</span>
        <span>${rv.rating.toFixed(1)}/10</span>
      </div>`).join('')
    : `<div class="popup-review-row"><span>No reviews yet</span></div>`;
  return `
    <div class="popup-title">${escapeHtml(r.name)}</div>
    <div class="popup-addr">${escapeHtml(r.address || '')}</div>
    ${avg !== null ? meterHtml(avg) : ''}
    <div class="popup-reviews">${rowsHtml}</div>
  `;
}

// ---------------- panel: detail + review form ----------------
function openDetailPanel(restaurantId) {
  activeRestaurantId = restaurantId;
  activeUserId = null;
  panelMode = 'detail';
  renderDetailPanel(restaurantId);
  panelOverlay.classList.add('open');
  renderEntryList();
}

function closePanel() {
  panelOverlay.classList.remove('open');
  activeRestaurantId = null;
  activeUserId = null;
  panelMode = null;
}
el('panel-overlay').addEventListener('click', (e) => {
  if (e.target === panelOverlay) closePanel();
});

function renderDetailPanel(restaurantId) {
  const r = restaurants.find(x => x.id === restaurantId);
  if (!r) { closePanel(); return; }
  const rs = reviewsFor(restaurantId);
  const myReview = rs.find(rv => rv.userId === currentUser?.uid);
  const avg = avgRating(restaurantId);

  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2 id="name-display">${escapeHtml(r.name)}${isAdmin ? ' <button class="edit-name-btn" id="edit-name-btn" title="Edit name">✏️</button>' : ''}</h2>
      <div class="sub">${escapeHtml(r.address || '')}</div>
      ${avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet — be the first</div>'}

      <div class="review-list">
        ${rs.map(rv => `
          <div class="review-item">
            <div class="who">
              <span class="who-name">${escapeHtml(displayNameFor(rv.userId, rv.userName))}${positionFor(rv.userId) ? ` <span class="who-badge">${escapeHtml(positionFor(rv.userId))}</span>` : ''}</span>
              <span>${rv.rating.toFixed(1)}/10</span>
            </div>
            <div class="breakdown">
              Burger ${Number(rv.burgerRating ?? rv.rating).toFixed(1)} ·
              Sides/Drinks ${Number(rv.sidesRating ?? rv.rating).toFixed(1)} ·
              Establishment ${Number(rv.establishmentRating ?? rv.rating).toFixed(1)}
            </div>
            ${rv.comment ? `<div class="comment">${escapeHtml(rv.comment)}</div>` : ''}
          </div>
        `).join('') || ''}
      </div>

      <hr style="border:none;border-top:1px dashed var(--line);margin:18px 0;">

      ${sliderField('burger', 'Burger', myReview?.burgerRating)}
      ${sliderField('sides', 'Sides / Drinks', myReview?.sidesRating)}
      ${sliderField('establishment', 'Establishment', myReview?.establishmentRating)}

      <div class="field">
        <label>Notes (optional)</label>
        <textarea id="review-comment" placeholder="What'd you get, how was it...">${escapeHtml(myReview?.comment || '')}</textarea>
      </div>
      <div class="panel-actions">
        <button class="btn" id="save-review-btn">${myReview ? 'Update your review' : 'Save your review'}</button>
        ${myReview ? '<button class="btn red small" id="delete-review-btn">Delete</button>' : ''}
        ${isAdmin ? '<button class="btn ghost-panel small" id="delete-entry-btn" title="Remove this place entirely">Remove place</button>' : ''}
      </div>
      <div class="error-msg" id="review-error"></div>
    </div>
  `;

  const selectedRatings = {
    burger: myReview?.burgerRating ?? 5.0,
    sides: myReview?.sidesRating ?? 5.0,
    establishment: myReview?.establishmentRating ?? 5.0
  };

  el('panel-close').addEventListener('click', closePanel);

  el('edit-name-btn')?.addEventListener('click', () => {
    const nameDisplay = el('name-display');
    nameDisplay.outerHTML = `
      <div class="name-edit-row" id="name-edit-row">
        <input type="text" id="edit-name-input" value="${escapeHtml(r.name)}">
        <button class="btn small" id="save-name-btn">Save</button>
        <button class="btn ghost-panel small" id="cancel-name-btn">Cancel</button>
      </div>
    `;
    el('edit-name-input').focus();
    el('edit-name-input').select();
    el('cancel-name-btn').addEventListener('click', () => renderDetailPanel(restaurantId));
    el('save-name-btn').addEventListener('click', async () => {
      const newName = el('edit-name-input').value.trim();
      if (!newName) return;
      await updateDoc(doc(db, 'restaurants', restaurantId), { name: newName });
    });
    el('edit-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el('save-name-btn').click();
      if (e.key === 'Escape') renderDetailPanel(restaurantId);
    });
  });

  ['burger', 'sides', 'establishment'].forEach(cat => {
    const input = document.querySelector(`input[data-cat="${cat}"]`);
    const readout = document.querySelector(`.slider-num[data-cat="${cat}"]`);
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      selectedRatings[cat] = val;
      readout.textContent = val.toFixed(1);
    });
  });

  el('save-review-btn').addEventListener('click', async () => {
    const errBox = el('review-error');
    errBox.textContent = '';
    const comment = el('review-comment').value.trim();
    const overall = (selectedRatings.burger + selectedRatings.sides + selectedRatings.establishment) / 3;
    const reviewId = `${restaurantId}_${currentUser.uid}`;
    try {
      await setDoc(doc(db, 'reviews', reviewId), {
        restaurantId,
        userId: currentUser.uid,
        userName: displayNameFor(currentUser.uid, currentUser.email.split('@')[0]),
        burgerRating: selectedRatings.burger,
        sidesRating: selectedRatings.sides,
        establishmentRating: selectedRatings.establishment,
        rating: Math.round(overall * 10) / 10,
        comment,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      errBox.textContent = "Couldn't save — check your connection and try again.";
    }
  });

  if (myReview) {
    el('delete-review-btn')?.addEventListener('click', async () => {
      await deleteDoc(doc(db, 'reviews', `${restaurantId}_${currentUser.uid}`));
    });
  }

  if (isAdmin) {
    el('delete-entry-btn')?.addEventListener('click', async () => {
      if (!confirm(`Remove "${r.name}" and all its reviews? This can't be undone.`)) return;
      await Promise.all(rs.map(rv => deleteDoc(doc(db, 'reviews', rv.id))));
      await deleteDoc(doc(db, 'restaurants', restaurantId));
      closePanel();
    });
  }
}

// ---------------- panel: add entry (admin) ----------------
let selectedPlace = null; // {lat, lng} set once a suggestion is picked
let searchDebounceId = null;
let searchRequestSeq = 0;

addEntryBtn.addEventListener('click', () => {
  activeRestaurantId = null;
  panelMode = 'add';
  selectedPlace = null;
  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>Add a place</h2>
      <div class="sub">Start typing — pick a match and the address fills in automatically.</div>
      <div class="field" style="position:relative;">
        <label>Search</label>
        <input type="text" id="place-search" placeholder="e.g. Big Al's Burgers" autocomplete="off">
        <div id="place-suggestions" class="suggestions hidden"></div>
      </div>
      <div class="field">
        <label>Name</label>
        <input type="text" id="new-name" placeholder="e.g. Big Al's Burgers">
      </div>
      <div class="field">
        <label>Address</label>
        <input type="text" id="new-address" placeholder="123 Main St, Brooklyn, NY">
      </div>
      <div class="panel-actions">
        <button class="btn" id="geocode-save-btn">Save place</button>
      </div>
      <div class="error-msg" id="add-error"></div>
    </div>
  `;
  panelOverlay.classList.add('open');
  el('panel-close').addEventListener('click', closePanel);
  el('geocode-save-btn').addEventListener('click', handleAddEntry);

  const searchInput = el('place-search');
  const suggestionsBox = el('place-suggestions');

  searchInput.addEventListener('input', () => {
    selectedPlace = null;
    const q = searchInput.value.trim();
    clearTimeout(searchDebounceId);
    if (q.length < 3) {
      suggestionsBox.classList.add('hidden');
      suggestionsBox.innerHTML = '';
      return;
    }
    searchDebounceId = setTimeout(() => runPlaceSearch(q, suggestionsBox), 350);
  });

  document.addEventListener('click', (e) => {
    if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
      suggestionsBox.classList.add('hidden');
    }
  });
});

async function runPlaceSearch(q, suggestionsBox) {
  const seq = ++searchRequestSeq;
  try {
    // Biased toward NYC (where the map defaults) — still finds places anywhere.
    const resp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=40.7128&lon=-74.0060&zoom=12`);
    const data = await resp.json();
    if (seq !== searchRequestSeq) return; // a newer search superseded this one
    const features = data.features || [];
    if (!features.length) {
      suggestionsBox.innerHTML = `<div class="suggestion-item muted">No matches — you can still fill in the fields manually below.</div>`;
      suggestionsBox.classList.remove('hidden');
      return;
    }
    suggestionsBox.innerHTML = features.map((f, i) => {
      const p = f.properties;
      const name = p.name || q;
      const addrParts = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city, p.state, p.postcode].filter(Boolean);
      const addr = addrParts.join(', ');
      return `<button type="button" class="suggestion-item" data-idx="${i}">
        <div class="s-name">${escapeHtml(name)}</div>
        <div class="s-addr">${escapeHtml(addr)}</div>
      </button>`;
    }).join('');
    suggestionsBox.classList.remove('hidden');
    suggestionsBox.querySelectorAll('.suggestion-item[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = features[Number(btn.dataset.idx)];
        const p = f.properties;
        const name = p.name || q;
        const addrParts = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city, p.state, p.postcode].filter(Boolean);
        el('new-name').value = name;
        el('new-address').value = addrParts.join(', ');
        const [lng, lat] = f.geometry.coordinates;
        selectedPlace = { lat, lng };
        suggestionsBox.classList.add('hidden');
        el('place-search').value = name;
      });
    });
  } catch (err) {
    if (seq !== searchRequestSeq) return;
    suggestionsBox.innerHTML = `<div class="suggestion-item muted">Search failed — you can still fill in the fields manually below.</div>`;
    suggestionsBox.classList.remove('hidden');
  }
}

async function handleAddEntry() {
  const name = el('new-name').value.trim();
  const address = el('new-address').value.trim();
  const errBox = el('add-error');
  errBox.textContent = '';
  if (!name || !address) { errBox.textContent = 'Fill in both the name and address.'; return; }
  const btn = el('geocode-save-btn');
  btn.disabled = true;

  try {
    let lat, lng;
    if (selectedPlace) {
      // Coordinates already known from the picked suggestion — no extra lookup needed.
      ({ lat, lng } = selectedPlace);
    } else {
      // Manual entry (no suggestion picked) — geocode the typed address as a fallback.
      btn.textContent = 'Looking up address...';
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
      const results = await resp.json();
      if (!results.length) {
        errBox.textContent = "Couldn't find that address — try adding city/state, or check spelling.";
        btn.disabled = false; btn.textContent = 'Save place';
        return;
      }
      lat = parseFloat(results[0].lat);
      lng = parseFloat(results[0].lon);
    }
    await addDoc(collection(db, 'restaurants'), {
      name,
      address,
      lat,
      lng,
      addedBy: currentUser.email,
      createdAt: serverTimestamp()
    });
    closePanel();
  } catch (err) {
    errBox.textContent = "Something went wrong saving that place. Try again.";
    btn.disabled = false; btn.textContent = 'Save place';
  }
}

// ---------------- panel: account ----------------
function openAccountPanel() {
  activeRestaurantId = null;
  panelMode = 'account';
  const me = users.find(u => u.id === currentUser.uid);
  const myName = (me && me.displayName) || currentUser.email.split('@')[0];
  const myReviews = reviews.filter(rv => rv.userId === currentUser.uid);

  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>Your account</h2>
      <div class="sub">${escapeHtml(currentUser.email)}</div>

      <div class="club-position">
        <div class="cp-text">
          <span class="cp-label">Club Position</span>
          <span class="cp-value" id="cp-value">${escapeHtml((me && me.clubPosition) || 'Member')}</span>
        </div>
        <button class="btn small" id="reroll-position-btn" title="Get a new random title">🎲 Re-roll</button>
      </div>

      <div class="field">
        <label>Display name</label>
        <input type="text" id="display-name-input" value="${escapeHtml(myName)}">
      </div>
      <button class="btn small" id="save-display-name-btn">Save name</button>
      <div class="error-msg" id="account-error"></div>

      <hr style="border:none;border-top:1px dashed var(--line);margin:18px 0;">

      <div class="sub" style="margin-bottom:8px;">Your reviews (${myReviews.length})</div>
      <div class="review-list">
        ${myReviews.length ? myReviews.map(rv => {
          const restaurant = restaurants.find(r => r.id === rv.restaurantId);
          return `
            <div class="review-item">
              <div class="who">
                <span>${escapeHtml(restaurant ? restaurant.name : 'Unknown place')}</span>
                <span>${rv.rating.toFixed(1)}/10</span>
              </div>
              <div class="breakdown">
                Burger ${Number(rv.burgerRating ?? rv.rating).toFixed(1)} ·
                Sides/Drinks ${Number(rv.sidesRating ?? rv.rating).toFixed(1)} ·
                Establishment ${Number(rv.establishmentRating ?? rv.rating).toFixed(1)}
              </div>
              ${rv.comment ? `<div class="comment">${escapeHtml(rv.comment)}</div>` : ''}
              <div class="my-review-actions">
                <button class="btn ghost-panel small" data-goto="${rv.restaurantId}">Edit</button>
                <button class="btn red small" data-del="${rv.id}">Delete</button>
              </div>
            </div>
          `;
        }).join('') : `<div class="count-tag">You haven't reviewed anywhere yet.</div>`}
      </div>
    </div>
  `;
  panelOverlay.classList.add('open');

  el('panel-close').addEventListener('click', closePanel);

  el('reroll-position-btn').addEventListener('click', async () => {
    const current = (me && me.clubPosition) || null;
    let next = current;
    while (next === current) {
      next = CLUB_POSITIONS[Math.floor(Math.random() * CLUB_POSITIONS.length)];
    }
    el('cp-value').textContent = next;
    try {
      await setDoc(doc(db, 'users', currentUser.uid), { clubPosition: next }, { merge: true });
    } catch (err) { /* non-critical */ }
  });

  el('save-display-name-btn').addEventListener('click', async () => {
    const errBox = el('account-error');
    errBox.textContent = '';
    const newName = el('display-name-input').value.trim();
    if (!newName) { errBox.textContent = 'Enter a name.'; return; }
    try {
      await setDoc(doc(db, 'users', currentUser.uid), { displayName: newName, email: currentUser.email }, { merge: true });
    } catch (err) {
      errBox.textContent = "Couldn't save — try again.";
    }
  });

  panelBody.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => openDetailPanel(btn.dataset.goto));
  });
  panelBody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this review?')) return;
      await deleteDoc(doc(db, 'reviews', btn.dataset.del));
    });
  });
}
