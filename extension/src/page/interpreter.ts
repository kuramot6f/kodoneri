import Sval from "sval";

/** Injected only into pages whose CSP blocks eval; run_js picks it up from here. */
(globalThis as unknown as { __chatextSval: typeof Sval }).__chatextSval = Sval;
