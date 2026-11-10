# Administrator access

The hosted dashboard, iPad marshal screen, driver phone screen and reports link to `/rankflow/admin.html`.

Choose **Sign in with ChatGPT** and use `obeirnefrank@gmail.com`. Sites handles the sign-in and supplies verified identity headers. The Worker checks the administrator email on every admin request. Shared event codes and other ChatGPT accounts do not grant administrator access. The hosting environment can override the owner address with `ADMIN_EMAIL`.

The administrator page edits driver names and two-digit taxi numbers and opens existing dispatch, departure and reporting tools. Updates reject stale versions, duplicate taxi numbers and drivers with active jobs. Successful changes and their actor are stored atomically in `admin_audit`. Sign out from the administrator page when finished on a shared device.

These changes apply to the hosted Worker app in `work`; the separate PostgreSQL server at the repository root retains its existing password-based account system.

Validation: the production build and six focused tests pass, including administrator authorization, audit persistence, concurrent-edit rejection, active-job protection, driver workflow, job history and push notifications. Hosted ChatGPT sign-in needs the Sites deployment; local previews do not simulate a signed-in administrator.
