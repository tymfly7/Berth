# RULES

The Four Principles in Detail
1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

LLMs often pick an interpretation silently and run with it. This principle forces explicit reasoning:

    State assumptions explicitly — If uncertain, ask rather than guess
    Present multiple interpretations — Don't pick silently when ambiguity exists
    Push back when warranted — If a simpler approach exists, say so
    Stop when confused — Name what's unclear and ask for clarification




2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

Combat the tendency toward overengineering:

    No features beyond what was asked
    No abstractions for single-use code
    No "flexibility" or "configurability" that wasn't requested
    No error handling for impossible scenarios
    If 200 lines could be 50, rewrite it

The test: Would a senior engineer say this is overcomplicated? If yes, simplify.
3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

    Don't "improve" adjacent code, comments, or formatting
    Don't refactor things that aren't broken
    Match existing style, even if you'd do it differently
    If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:

    Remove imports/variables/functions that YOUR changes made unused
    Don't remove pre-existing dead code unless asked

The test: Every changed line should trace directly to the user's request.
4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform imperative tasks into verifiable goals:
Instead of... 	Transform to...
"Add validation" = "Write tests for invalid inputs, then make them pass"
"Fix the bug" = "Write a test that reproduces it, then make it pass"
"Refactor X"  =	"Ensure tests pass before and after"


5. Workflow Requirements.
Always log implementation work to the requested phase log file as a standard step at the END of every feature/bug-fix task, without needing to be reminded.


6. Logging Conventions
When logging work, ALWAYS confirm the exact target log file (e.g., log_phaseN.md) before writing, and write only to the file the user named.


7. Agent cordination
When you are told to instruct an agent do not do it in the background. Print out prompts for the human to read and aprove your instruction to the agent and copy them or tell you to go ahead. 

9. Frontend / Backend
After any frontend and backend change (removing imports, refactoring), verify there are no orphaned references or missing dependencies or module imports by checking imports and running the dev build or confirming backend structure is intact before declaring done.


10. Performance / Exploration section.
Do not read large directories or run polling commands; respect directory restrictions and prefer targeted Glob/Grep instead of broad reads.

11. Large directories — do NOT read file contents
These directories contain huge numbers of files. Reading individual file contents will exhaust token limits and cause failures.

- `backend/data/` — training image dataset (thousands of photos). You may check if subdirectories that they exist, but never read or glob individual file contents.
- `frontend/node_modules/` — npm packages. You may run npm commands but never read source files inside here.
- `backend/venv/` (or any virtualenv directory) — Python packages. Use `pip show <pkg>` or `pip list` for package info, never read files inside.


## ALWAYS ASK FOR PERMISION TO GO AHEAD OR EDIT FILES