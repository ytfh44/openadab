# Adjust Packaged Binary Resolution

## Summary
After implementing NSIS packaging and binary resolution utilities, three main specs need micro-adjustments to accurately describe the packaged-app binary discovery behavior.

## Motivation
The NSIS installer downloads opencode CLI at install time and places it in `$INSTDIR`. The app now searches `$INSTDIR`, `resources/cli/`, and `resources/` for both openadab CLI and opencode CLI before falling back to PATH. The main specs do not yet reflect these resolution paths.
