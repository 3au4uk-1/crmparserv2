# crmparserv2

CRM branding parser — backend, frontend, and ops tooling for the `twenty_brand` stack (Twenty CRM + crmparser on Dokploy).

## Production releases

Every prod promote (staging→main for this repo and BrandingTwentyView) must follow the backup gate and rollback playbook:

1. Optional staging data refresh + smoke
2. **Mandatory** `release-prepare` workflow with real prod versions
3. Merge and watch CD
4. Prod smoke; on failure use rollback workflows

Full operator steps, secrets, volume names, verification checklist, and disaster notes:

**[ops/backup/README.md](ops/backup/README.md)**
