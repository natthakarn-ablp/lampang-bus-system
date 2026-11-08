'use strict';

// Where "which LINE accounts are bound to which parent phone" is read from.
//
// line_bindings holds the ONE primary LINE account per phone. M2 (parent audit
// 2026-11-08) adds up to two co-guardians per phone in line_co_guardians
// (migration 058). Every read path that turns a LINE account into children,
// or a child into LINE recipients, selects FROM this source aliased `lb` with
// columns (phone, line_user_id, is_active, bound_at), so co-guardians see and
// receive exactly what the primary does.
//
// With FEATURE_CO_GUARDIAN off the source is plain `line_bindings`: the SQL is
// byte-for-byte what it was, and nothing touches the 058 table (which may not
// exist yet). Writes (bind/unbind) stay on line_bindings / line_co_guardians
// explicitly; this is for reads only.

const env = require('../config/env');

function activeBindingsSql() {
  if (env.features.coGuardian !== true) return 'line_bindings';
  return '(SELECT phone, line_user_id, is_active, bound_at FROM line_bindings'
    + ' UNION ALL SELECT phone, line_user_id, is_active, bound_at FROM line_co_guardians)';
}

module.exports = { activeBindingsSql };
