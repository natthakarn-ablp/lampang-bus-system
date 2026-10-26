'use strict';

// Current upload forms use flat metadata. Keep their existing file-size caps,
// and bound bracket notation before multer/append-field expands user input.
function multipartLimits(fileSize) {
  return { fileSize, fieldNestingDepth: 4, fieldArrayIndexLimit: 32 };
}

module.exports = { multipartLimits };
