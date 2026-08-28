#!/bin/sh
# Runs every check. Exits non-zero on the first failure.
set -e
node test-answers.js
echo
node test-verbs.js
