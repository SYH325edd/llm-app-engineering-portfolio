# Requirements Lock Note

`requirements.txt` is the baseline dependency list for the LakeJob MVP. It is not a strict lockfile and does not pin every transitive dependency.

For repeatable production installs, generate a platform-specific lockfile with your preferred tool after validating the local Python and Playwright versions.
