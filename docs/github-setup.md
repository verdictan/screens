# GitHub setup

Intended organization: `verdictan`. Repository: `verdictan/screens` (private).
GitHub Projects title: `screens`.

The bootstrap helper uses the authenticated GitHub CLI. It checks for an existing
repository and project before creating either, then creates roadmap issues and
adds them to the board. It is safe to rerun after a partial setup. It does not
publish code, grant access, install credentials, or alter organization settings.

```sh
node scripts/bootstrap-github.mjs
```

Requires repository creation permission and GitHub Projects write access.
If the current token lacks Projects scope, an authorized user must update its
access. The helper does not request or broaden credential permissions itself.

After creation, push the reviewed initial commit to the new repository. The
first implementation milestone is tracked as in progress until live integration,
browser QA and actual agent-client checks pass.
