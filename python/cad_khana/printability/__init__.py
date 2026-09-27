"""cad_khana.printability: FDM settings (provided) and printability checks (refused)."""

from cad_khana import _wonky

__getattr__ = _wonky.module_getattr(__name__, __file__)
