import sys
from pathlib import Path

# Make `import asr.pipeline` work regardless of the cwd pytest was invoked
# from (worktree root or elsewhere), without needing asr/ installed as a
# package.
_WORKTREE_ROOT = Path(__file__).resolve().parent.parent
if str(_WORKTREE_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKTREE_ROOT))
