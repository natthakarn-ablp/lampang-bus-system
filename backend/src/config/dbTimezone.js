'use strict';

// Single source of truth for the MySQL SESSION timezone.
//
// The server runs in UTC but every "today" read computes the Bangkok date, so
// each connection pins +07:00 to make CURDATE()/NOW() mean the Bangkok day (see
// the long note in ./database.js). Anything that opens its own connection and
// then compares against CURDATE() — the app pool, and the integration-test
// helpers — must pin the SAME offset, or the two disagree for the seven hours
// between 00:00 and 07:00 Bangkok and each reads a different "today".
const DB_TIMEZONE = '+07:00';

module.exports = { DB_TIMEZONE };
