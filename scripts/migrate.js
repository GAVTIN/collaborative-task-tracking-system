/** `npm run migrate` - applies any pending database migrations and exits. */
import { migrate } from '../src/db/migrate.js';
import db from '../src/db/index.js';

const applied = migrate();
console.log(applied ? `Applied ${applied} migration(s).` : 'Database is already up to date.');
db.close();
