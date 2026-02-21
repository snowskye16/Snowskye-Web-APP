const bcrypt = require("bcrypt");
bcrypt.hash("YOUR_PASSWORD_HERE", 10).then(console.log);