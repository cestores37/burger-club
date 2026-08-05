// ============================================================
// FIREBASE CONFIG
// Replace every value below with the config from your own
// Firebase project (Project settings → General → Your apps → Web app).
// This file is safe to make public — Firebase web config is not
// a secret key, it just tells the SDK which project to talk to.
// Access is actually controlled by the Firestore Security Rules
// (see firestore.rules) and Firebase Authentication.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBYsGz5NnngU3cjCi34teUqyD6LFHm65wg",
  authDomain: "burger-club-e099e.firebaseapp.com",
  projectId: "burger-club-e099e",
  storageBucket: "burger-club-e099e.firebasestorage.app",
  messagingSenderId: "1039476836082",
  appId: "1:1039476836082:web:8dd951918e1fe5405f326b"
};

// Emails allowed to add/edit/delete entries (everyone else can still
// log in and leave reviews, they just won't see the "+ Add Entry" button).
// This MUST match the isAdmin() list in firestore.rules exactly,
// otherwise the button will show but Firestore will reject the write.
export const ADMIN_EMAILS = [
  "c.estores37@gmail.com"
];
