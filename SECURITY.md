# Security policy

## Report a vulnerability

Report problems privately. Do not open a public issue.

1. Open the [Security tab](https://github.com/hardikg2907/sparmate/security) of this repository.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the problem, the steps to reproduce it, and what an attacker could do.

You will get a reply as soon as the maintainer can read the report. Please allow time for a fix before you share details in public.

## What counts

Sparmate runs on your own machine and handles code and files that you did not review line by line. These areas matter most:

- **The C++ sandbox.** Submitted code escapes the sandbox, reads files it should not (such as your home folder or study folder), reaches the network, forks past its limits, or outlives its time limit.
- **The privacy guard.** A listed term, an email address or a home-folder path gets past the guard into a study file, a log or a commit.
- **File writes outside the study folder.** The app writes anywhere other than the study folder, the round data folder or the build folder, or overwrites a study file without an explicit save.
- **The local HTTP server.** A web page you visit can call the server, read its data or change files (for example through missing CSRF or origin checks), or the server accepts connections from other machines.

Bugs that need an attacker who already has full control of your account or machine are out of scope.

## Supported versions

Only the latest commit on `main` receives security fixes. There are no released versions yet.
