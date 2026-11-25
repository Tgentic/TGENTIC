"""tgentic — Python SDK for TGENTIC agent reputation. Zero dependencies."""

from .client import ADDRESSES, CHAIN_ID, MAINNET_RPC, Client, create_client
from .flags import compute_flags

__version__ = "0.1.0"
__all__ = ["ADDRESSES", "CHAIN_ID", "MAINNET_RPC", "Client", "create_client", "compute_flags"]
