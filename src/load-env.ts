// Loads .env before Nest reads process.env, including REPORT_ENCRYPTION_KEY.
import { config } from 'dotenv';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
config({ path: envPath });
