// nodegeneratekey.js
const crypto = require("crypto");

function generateKey() {
  return "sk-" + crypto.randomUUID();
}

console.log("New SnowSkye Website Key:");
console.log(generateKey());