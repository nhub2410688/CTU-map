# CTU Map

## Requirements

- Node.js 20 or newer
- PostgreSQL 15 or newer

## Local setup

1. Copy `.env.example` to `.env`.
2. Update `DATABASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`.
3. Create the PostgreSQL database referenced by `DATABASE_URL`.
4. Run `npm run db:migrate`.
5. Run `npm test`.
6. Run `npm start`.

The `npm run db:migrate` command creates the relational schema, imports
existing `data/db.json` records with stable IDs, and seeds the configured
tester admin. Existing student SHA-256 hashes are imported only for
compatibility. Each legacy hash is replaced by Argon2id after that student
logs in successfully.

`npm start` never reads `data/db.json`. The file is ignored by Git because it
contains user data. Keep a backup until the PostgreSQL import has been
checked, then treat PostgreSQL as the only source of truth.

## Project structure

- `app.js`: Express app, API routes, authentication checks, map search logic,
  schedule validation, and document-sharing endpoints.
- `database.js`: PostgreSQL access layer, schema initialization, migration from
  legacy `data/db.json`, session storage, timetable, teacher, subject, and
  document metadata operations.
- `security.js`: password hashing, legacy password compatibility, and session
  token helpers.
- `src/config.js`: environment-driven server/admin/upload configuration.
- `src/map-data.js`: map nodes, graph edges, buildings, parking lots, and map
  scale. Update node/cung data here.
- `src/document-files.js`: upload folder setup, file type checks, multipart
  parsing, and document response formatting.
- `public/`: browser pages, CSS, JavaScript, and image assets.
- `sql/001_initial.sql`: PostgreSQL schema.
- `scripts/migrate.js`: local migration/import command.
- `test/`: API and security regression tests.

## Tester admin

The login page intentionally displays the configured tester credentials.
Change both values in `.env` locally or in the hosting provider's environment
variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

The application synchronizes that account into PostgreSQL at startup.

## Study documents

Student-uploaded study documents are stored as original files in
`storage/uploads/`. PostgreSQL stores only metadata such as title, subject,
teacher, uploader, file name, file size, and approval status. New uploads
start as `pending`; an admin must approve them before they are shared with
other students.

PDF, image, TXT, and CSV files can be opened directly in the browser. Word,
PowerPoint, and Excel files are kept as original files and should be downloaded
to view.

For real deployment with many files, replace local `storage/uploads/` with
object storage such as Cloudflare R2, S3, Supabase Storage, or another
provider. Keep PostgreSQL as the metadata database.

## Render deployment

1. Push the source to a private GitHub repository without `.env` or
   `data/db.json`.
2. Create a paid Render PostgreSQL database.
3. Use its external URL locally once with `npm run db:migrate` to import the
   legacy data.
4. Create a paid Render Web Service from the repository.
5. Use `npm ci` as the build command and `npm start` as the start command.
6. Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and
   `NODE_ENV=production` in Render.
7. Set `DATABASE_SSL=true` only when the selected PostgreSQL connection
   requires TLS.
8. Deploy and verify registration, login, schedules, and admin operations.

The application binds to `0.0.0.0` and uses the hosting provider's `PORT`.
