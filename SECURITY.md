# Security

## Reporting a vulnerability

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/Mikephii/nsw-realvision/security/advisories/new).
Please do not open a public issue.

Include what you found, how to reproduce it, and which commit or release it affects. NSW RealVision
is maintained in spare time, so this is best effort: I aim to acknowledge a report within a week and
keep you told of progress.

## What is in scope

The code in this repository: the webapp's server functions and their input validation, the DuckDB
query building, the Docker image, and the ETL in `scripts/`. Anything that lets a request run
arbitrary SQL, read files outside the database, or take the server down with a single cheap request
is in scope.

## Things to know before deploying

- **The app has no authentication.** Anyone who can reach it can use it. If it shouldn't be public,
  put it behind a proxy that signs people in (see [docs/self-hosting.md](docs/self-hosting.md)).
- The database is opened read-only by the server in S3 mode. In local mode it opens the file
  directly, so mount it read-only in containers.
- The data is public NSW Valuer General sales data. The app never stores purchaser or vendor names.
