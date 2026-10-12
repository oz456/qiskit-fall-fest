// Usage: npm run hash-password -- 'your-long-password'   → prints a value for ADMIN_PASSWORD_HASH
import { hashPassword } from "../src/lib/crypto.ts";
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error("Provide a password of at least 12 characters."); process.exit(1); }
console.log(hashPassword(pw));
