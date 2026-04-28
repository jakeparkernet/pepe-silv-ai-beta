#!/usr/bin/env python3
"""
Development runner for Pepe Silv.AI
Runs both coordinator and REST API servers in a single process for easy debugging.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

import asyncio
import app.main as _main

if __name__ == "__main__":
    try:
        exit_code = asyncio.run(_main.run())
        raise SystemExit(exit_code)
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
        raise SystemExit(0)