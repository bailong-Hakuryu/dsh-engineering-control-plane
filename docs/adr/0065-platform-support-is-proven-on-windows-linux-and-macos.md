---
status: accepted
---

# Platform support is proven on Windows, Linux, and macOS

The v0.2 compatibility matrix includes Windows, Linux, and macOS under the same Node range. CI exercises Kernel, SQLite, Git, stable file identity, packaging, and recovery on each platform, with Windows-specific junction, reparse-point, drive and case behavior and POSIX symlink, inode and permission replacement cases. A platform lacking a required containment or identity primitive enters Safe Mode rather than receiving a weaker execution boundary.
