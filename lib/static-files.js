const crypto = require('crypto');
const fs = require('fs');
const express = require('express');

// Serves public/. `extensions` resolves /privacy-policy to privacy-policy.html:
// extensionless links exist on the site and have to resolve now that unknown
// paths return a real 404.
//
// Validators come from the file's bytes. express.static's defaults are the
// file's size and mtime, and Vercel deploys every file with the same fixed
// mtime (Oct 20 2018), so an edit that kept a page the same length (8–6 -> 8–7
// on the homepage season record) kept the same ETag and Last-Modified.
// Returning browsers revalidated, were told 304, and kept the old page.
// Last-Modified is dropped outright because that date never moves.
//
// Hashed per request rather than cached: the pages are small, and a cache would
// go stale under nodemon, where files change without a restart.
function publicStatic(dir) {
  return express.static(dir, {
    extensions: ['html'],
    lastModified: false,
    // send only sets its own ETag when none is present, so this one wins.
    setHeaders(res, filePath) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('base64url');
      res.setHeader('ETag', `"${hash.slice(0, 27)}"`);
    },
  });
}

module.exports = { publicStatic };
