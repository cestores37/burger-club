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
let favorites = [];      // [{id ("uid_restaurantId"), userId, restaurantId}]
let map = null;
let markers = new Map(); // restaurantId -> leaflet marker
let activeRestaurantId = null;
let activeUserId = null;
let panelMode = null; // 'detail' | 'add' | 'account' | 'user'

// per-user, local-only view filters (never written to Firestore)
let filterAddedBy = '';
let filterOfficialOnly = false;
let filterFavoritesOnly = false;

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
const suggestEntryBtn = el('suggest-entry-btn');
const filterAddedBySelect = el('filter-added-by');
const filterOfficialCheckbox = el('filter-official');
const filterFavoritesCheckbox = el('filter-favorites');
const panelOverlay = el('panel-overlay');
const panelBody = el('panel-body');

el('tab-places').addEventListener('click', () => setSidebarTab('places'));
el('tab-leaderboard').addEventListener('click', () => setSidebarTab('leaderboard'));

function setSidebarTab(tab) {
  el('tab-places').classList.toggle('active', tab === 'places');
  el('tab-leaderboard').classList.toggle('active', tab === 'leaderboard');
  el('places-view').classList.toggle('hidden', tab !== 'places');
  el('filters-bar').classList.toggle('hidden', tab !== 'places');
  leaderboardView.classList.toggle('hidden', tab !== 'leaderboard');
}

filterAddedBySelect.addEventListener('change', () => {
  filterAddedBy = filterAddedBySelect.value;
  renderEntryList();
  renderMarkers();
});
filterOfficialCheckbox.addEventListener('change', () => {
  filterOfficialOnly = filterOfficialCheckbox.checked;
  renderEntryList();
  renderMarkers();
});
filterFavoritesCheckbox.addEventListener('change', () => {
  filterFavoritesOnly = filterFavoritesCheckbox.checked;
  renderEntryList();
  renderMarkers();
});

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
    suggestEntryBtn.classList.toggle('hidden', isAdmin);
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

  onSnapshot(collection(db, 'favorites'), (snap) => {
    favorites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntryList();
    renderMarkers();
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
function addedByName(r) {
  return displayNameFor(r.addedByUid, r.suggestedByName || (r.addedBy ? r.addedBy.split('@')[0] : 'a member'));
}
function isFavorited(restaurantId) {
  if (!currentUser) return false;
  return favorites.some(f => f.userId === currentUser.uid && f.restaurantId === restaurantId);
}
async function toggleFavorite(restaurantId) {
  const favId = `${currentUser.uid}_${restaurantId}`;
  const ref = doc(db, 'favorites', favId);
  try {
    if (isFavorited(restaurantId)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { userId: currentUser.uid, restaurantId, createdAt: serverTimestamp() });
    }
  } catch (err) { /* non-critical */ }
}
function passesFilters(r) {
  if (filterOfficialOnly && !r.official) return false;
  if (filterFavoritesOnly && !isFavorited(r.id)) return false;
  if (filterAddedBy) {
    const contributorKey = r.addedByUid || r.addedBy || '';
    if (contributorKey !== filterAddedBy) return false;
  }
  return true;
}
function renderAddedByFilterOptions() {
  const seen = new Map(); // key -> label
  restaurants.forEach(r => {
    const key = r.addedByUid || r.addedBy;
    if (!key) return;
    if (!seen.has(key)) seen.set(key, displayNameFor(r.addedByUid, r.suggestedByName || (r.addedBy ? r.addedBy.split('@')[0] : 'Someone')));
  });
  const current = filterAddedBySelect.value;
  filterAddedBySelect.innerHTML = `<option value="">All members</option>` +
    Array.from(seen.entries()).map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
  if ([...seen.keys()].includes(current)) filterAddedBySelect.value = current;
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
function entryCardHtml(r) {
  const isSuggested = r.status === 'suggested';
  const avg = avgRating(r.id);
  const count = reviewsFor(r.id).length;
  const fav = isFavorited(r.id);
  return `
    <div class="entry-card${isSuggested ? ' suggested' : ''}${r.id === activeRestaurantId ? ' active' : ''}" data-id="${r.id}">
      ${r.official ? '<img src="logo.png" alt="Official Burger Club location" class="official-badge" title="Official Burger Club location">' : ''}
      <h3>${fav ? '❤️ ' : ''}${escapeHtml(r.name)}</h3>
      <div class="addr">${escapeHtml(r.address || '')}</div>
      ${isSuggested
        ? `<div class="count-tag">Suggested by ${escapeHtml(addedByName(r))}</div>`
        : (avg !== null ? meterHtml(avg) : '<div class="count-tag">No ratings yet</div>')}
      ${!isSuggested ? `<div class="entry-meta-row"><span class="count-tag">${count} review${count === 1 ? '' : 's'}</span></div>` : ''}
    </div>
  `;
}

function renderEntryList() {
  renderAddedByFilterOptions();

  if (!restaurants.length) {
    entryList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const filtered = restaurants.filter(passesFilters);
  const active = filtered.filter(r => r.status !== 'suggested');
  const suggested = filtered.filter(r => r.status === 'suggested');

  const activeHtml = active.length
    ? active.map(entryCardHtml).join('')
    : `<div class="count-tag section-empty">No places match these filters.</div>`;
  const suggestedHtml = suggested.length
    ? suggested.map(entryCardHtml).join('')
    : `<div class="count-tag section-empty">No suggestions match these filters.</div>`;

  entryList.innerHTML = `
    <div class="entry-section">
      <h3 class="entry-section-header reviews-header">Reviews</h3>
      ${activeHtml}
    </div>
    <div class="entry-section">
      <h3 class="entry-section-header tbt-header">Suggested Club Meeting Locations</h3>
      ${suggestedHtml}
    </div>
  `;

  entryList.querySelectorAll('.entry-card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      openDetailPanel(id);
      if (markers.has(id)) {
        map.flyTo(markers.get(id).getLatLng(), 15, { duration: 0.6 });
        markers.get(id).openPopup();
      }
      closeSidebar();
    });
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

function burgerDivIconSuggested() {
  return L.divIcon({
    className: '',
    html: `<div class="burger-pin suggested"><span>🍔</span></div>`,
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
    if (!passesFilters(r)) return; // filtered out — don't show this pin
    seen.add(r.id);
    const popupHtml = buildPopupHtml(r);
    const icon = r.status === 'suggested' ? burgerDivIconSuggested() : burgerDivIcon();
    if (markers.has(r.id)) {
      const m = markers.get(r.id);
      m.setLatLng([r.lat, r.lng]);
      m.setPopupContent(popupHtml);
      m.setIcon(icon);
    } else {
      const m = L.marker([r.lat, r.lng], { icon }).addTo(map);
      m.bindPopup(popupHtml);
      m.on('click', () => openDetailPanel(r.id));
      markers.set(r.id, m);
    }
  });
  // remove stale/filtered-out markers
  for (const [id, m] of markers.entries()) {
    if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); }
  }
}

function buildPopupHtml(r) {
  if (r.status === 'suggested') {
    return `
      <div class="popup-title">${r.official ? '⭐ ' : ''}${escapeHtml(r.name)}</div>
      <div class="popup-addr">${escapeHtml(r.address || '')}</div>
      <div class="popup-suggested-tag">🔵 Suggested by ${escapeHtml(addedByName(r))}</div>
    `;
  }
  const rs = reviewsFor(r.id);
  const avg = avgRating(r.id);
  const rowsHtml = rs.length
    ? rs.map(rv => `<div class="popup-review-row">
        <span>${escapeHtml(displayNameFor(rv.userId, rv.userName))}</span>
        <span>${rv.rating.toFixed(1)}/10</span>
      </div>`).join('')
    : `<div class="popup-review-row"><span>No reviews yet</span></div>`;
  return `
    <div class="popup-title">${r.official ? '⭐ ' : ''}${escapeHtml(r.name)}</div>
    <div class="popup-addr">${escapeHtml(r.address || '')}</div>
    <div class="popup-addedby">Added by ${escapeHtml(addedByName(r))}</div>
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

function renderSuggestionPanel(r, restaurantId) {
  const fav = isFavorited(restaurantId);
  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>${r.official ? '⭐ ' : ''}${escapeHtml(r.name)}</h2>
      <div class="sub">${escapeHtml(r.address || '')}</div>
      <button class="fav-btn${fav ? ' active' : ''}" id="fav-toggle-btn" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '❤️ Favorited' : '🤍 Favorite'}</button>
      <div class="suggestion-tag" style="margin-top:10px;">🔵 Suggested by ${escapeHtml(addedByName(r))}</div>
      ${r.notes ? `<div class="comment" style="margin-top:10px;">${escapeHtml(r.notes)}</div>` : ''}
      <p class="count-tag" style="margin:16px 0;">This place hasn't been added for reviews yet.</p>
      ${isAdmin ? `
        <div class="panel-actions">
          <button class="btn" id="promote-btn">Add to Places</button>
          <button class="btn red small" id="remove-suggestion-btn">Remove</button>
        </div>
      ` : ''}
      <div class="error-msg" id="suggestion-error"></div>
    </div>
  `;
  panelOverlay.classList.add('open');
  el('panel-close').addEventListener('click', closePanel);
  el('fav-toggle-btn').addEventListener('click', () => toggleFavorite(restaurantId));

  if (isAdmin) {
    el('promote-btn').addEventListener('click', async () => {
      const errBox = el('suggestion-error');
      errBox.textContent = '';
      try {
        await updateDoc(doc(db, 'restaurants', restaurantId), { status: 'active', promotedAt: serverTimestamp() });
        // refreshOpenPanel will re-render this same panel as a full review view automatically.
      } catch (err) {
        errBox.textContent = "Couldn't add it — try again.";
      }
    });
    el('remove-suggestion-btn').addEventListener('click', async () => {
      if (!confirm(`Remove the suggestion "${r.name}"?`)) return;
      await deleteDoc(doc(db, 'restaurants', restaurantId));
      closePanel();
    });
  }
}

function renderDetailPanel(restaurantId) {
  const r = restaurants.find(x => x.id === restaurantId);
  if (!r) { closePanel(); return; }
  if (r.status === 'suggested') { renderSuggestionPanel(r, restaurantId); return; }
  const rs = reviewsFor(restaurantId);
  const myReview = rs.find(rv => rv.userId === currentUser?.uid);
  const avg = avgRating(restaurantId);

  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2 id="name-display">${r.official ? '⭐ ' : ''}${escapeHtml(r.name)}${isAdmin ? ' <button class="edit-name-btn" id="edit-name-btn" title="Edit name">✏️</button>' : ''}</h2>
      <div class="sub">${escapeHtml(r.address || '')} · Added by ${escapeHtml(addedByName(r))}</div>
      <div class="detail-toolbar">
        <button class="fav-btn${isFavorited(restaurantId) ? ' active' : ''}" id="fav-toggle-btn" title="${isFavorited(restaurantId) ? 'Remove from favorites' : 'Add to favorites'}">${isFavorited(restaurantId) ? '❤️ Favorited' : '🤍 Favorite'}</button>
        ${isAdmin ? `<button class="official-toggle-btn${r.official ? ' active' : ''}" id="official-toggle-btn">${r.official ? '⭐ Official' : '☆ Mark Official'}</button>` : ''}
      </div>
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

  el('fav-toggle-btn').addEventListener('click', () => toggleFavorite(restaurantId));

  el('official-toggle-btn')?.addEventListener('click', async () => {
    try {
      await updateDoc(doc(db, 'restaurants', restaurantId), { official: !r.official });
    } catch (err) { /* non-critical */ }
  });

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

// ---------------- panel: add / suggest a place ----------------
let selectedPlace = null; // {lat, lng} set once a suggestion is picked
let searchDebounceId = null;
let searchRequestSeq = 0;
let placeFormMode = 'add'; // 'add' (admin, goes straight to Reviews) | 'suggest' (member, goes to To Be Tested)

function openPlaceFormPanel(mode, prefill) {
  activeRestaurantId = null;
  activeUserId = null;
  panelMode = 'placeform';
  placeFormMode = mode;
  selectedPlace = (prefill && prefill.selectedPlace) || null;
  const isSuggest = mode === 'suggest';
  panelBody.innerHTML = `
    <div class="panel-wrap">
      <button class="close-x" id="panel-close">&times;</button>
      <h2>${isSuggest ? 'Suggest Club Meeting Location' : 'Add a place'}</h2>
      <div class="sub">${isSuggest ? "Know a great spot for our next meetup? Search for it below." : "Start typing — pick a match and the address fills in automatically."}</div>
      <div class="field" style="position:relative;">
        <label>Search</label>
        <input type="text" id="place-search" placeholder="e.g. Big Al's Burgers" autocomplete="off" value="${escapeHtml((prefill && prefill.search) || '')}">
        <div id="place-suggestions" class="suggestions hidden"></div>
      </div>
      <div class="field">
        <label>Name</label>
        <input type="text" id="new-name" placeholder="e.g. Big Al's Burgers" value="${escapeHtml((prefill && prefill.name) || '')}">
      </div>
      <div class="field">
        <label>Address</label>
        <input type="text" id="new-address" placeholder="123 Main St, Brooklyn, NY" value="${escapeHtml((prefill && prefill.address) || '')}">
      </div>
      ${isSuggest ? `
        <div class="field">
          <label>Notes (optional)</label>
          <textarea id="new-notes" placeholder="Why here? Good for groups, happy hour, etc.">${escapeHtml((prefill && prefill.notes) || '')}</textarea>
        </div>
      ` : ''}
      <div class="panel-actions">
        <button class="btn" id="geocode-save-btn">${isSuggest ? 'Submit Location' : 'Save place'}</button>
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
}

addEntryBtn.addEventListener('click', () => openPlaceFormPanel('add'));
suggestEntryBtn.addEventListener('click', () => openPlaceFormPanel('suggest'));

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
  const isSuggest = placeFormMode === 'suggest';
  const defaultLabel = isSuggest ? 'Submit Location' : 'Save place';
  const name = el('new-name').value.trim();
  const address = el('new-address').value.trim();
  const notes = isSuggest ? (el('new-notes')?.value.trim() || '') : '';
  const errBox = el('add-error');
  errBox.textContent = '';
  if (!name || !address) { errBox.textContent = 'Fill in both the name and address.'; return; }

  // Duplicate check against everything already on the list (reviewed or suggested).
  const nameKey = name.trim().toLowerCase();
  const addrKey = address.trim().toLowerCase();
  const isDuplicate = restaurants.some(r =>
    (r.address && r.address.trim().toLowerCase() === addrKey) ||
    (r.name && r.name.trim().toLowerCase() === nameKey)
  );
  if (isDuplicate) {
    showDuplicateNotice(placeFormMode, { name, address, notes, search: el('place-search').value, selectedPlace });
    return;
  }

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
        btn.disabled = false; btn.textContent = defaultLabel;
        return;
      }
      lat = parseFloat(results[0].lat);
      lng = parseFloat(results[0].lon);
    }
    const payload = {
      name,
      address,
      lat,
      lng,
      addedBy: currentUser.email,
      addedByUid: currentUser.uid,
      createdAt: serverTimestamp()
    };
    if (isSuggest) {
      payload.status = 'suggested';
      payload.suggestedByName = displayNameFor(currentUser.uid, currentUser.email.split('@')[0]);
      payload.notes = notes;
    } else {
      payload.status = 'active';
    }
    await addDoc(collection(db, 'restaurants'), payload);
    closePanel();
  } catch (err) {
    errBox.textContent = "Something went wrong saving that place. Try again.";
    btn.disabled = false; btn.textContent = defaultLabel;
  }
}

function showDuplicateNotice(mode, prefill) {
  panelBody.innerHTML = `
    <div class="panel-wrap duplicate-notice">
      <button class="close-x" id="panel-close">&times;</button>
      <img src="logo.png" alt="Burger Club logo" class="duplicate-logo">
      <p class="duplicate-text">Good looks, we got that on the list already!</p>
      <button class="btn" id="duplicate-back-btn">Back to the form</button>
    </div>
  `;
  el('panel-close').addEventListener('click', closePanel);
  el('duplicate-back-btn').addEventListener('click', () => openPlaceFormPanel(mode, prefill));
}

// ---------------- panel: account ----------------
function openAccountPanel() {
  activeRestaurantId = null;
  panelMode = 'account';
  const me = users.find(u => u.id === currentUser.uid);
  const myName = (me && me.displayName) || currentUser.email.split('@')[0];
  const myReviews = reviews.filter(rv => rv.userId === currentUser.uid);
  const myFavorites = favorites
    .filter(f => f.userId === currentUser.uid)
    .map(f => restaurants.find(r => r.id === f.restaurantId))
    .filter(Boolean);

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

      <div class="sub" style="margin-bottom:8px;">Favorited spots (${myFavorites.length})</div>
      <div class="review-list">
        ${myFavorites.length ? myFavorites.map(r => `
          <div class="review-item fav-item" data-fav-goto="${r.id}">
            <div class="who">
              <span class="who-name">${r.official ? '⭐ ' : ''}❤️ ${escapeHtml(r.name)}</span>
            </div>
            <div class="breakdown">${escapeHtml(r.address || '')}</div>
          </div>
        `).join('') : `<div class="count-tag">No favorites yet — tap 🤍 on any place to save it here.</div>`}
      </div>

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
  panelBody.querySelectorAll('[data-fav-goto]').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.favGoto;
      openDetailPanel(id);
      if (markers.has(id) && map) {
        map.flyTo(markers.get(id).getLatLng(), 15, { duration: 0.6 });
        markers.get(id).openPopup();
      }
      closeSidebar();
    });
  });
}
