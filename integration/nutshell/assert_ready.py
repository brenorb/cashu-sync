#!/usr/bin/env python3
import json
import sys
import urllib.request


class ValidationError(Exception):
    pass


def require(condition: bool, name: str, actual: object) -> None:
    if not condition:
        raise ValidationError(f"{name}: {actual!r}")


def validate(info: dict) -> None:
    require(
        info.get("version") == "Nutshell/0.20.3",
        "unexpected Nutshell version",
        info.get("version"),
    )
    nuts = info.get("nuts", {})

    def supports_method(nut_number: int) -> bool:
        nut = nuts.get(str(nut_number), {})
        return nut.get("disabled") is False and any(
            entry.get("method") == "bolt11" and entry.get("unit") == "usd"
            for entry in nut.get("methods", [])
        )

    require(supports_method(4), "NUT-04 must support bolt11/USD", nuts.get("4"))
    require(supports_method(5), "NUT-05 must support bolt11/USD", nuts.get("5"))
    require(
        nuts.get("7", {}).get("supported") is True,
        "NUT-07 must be supported",
        nuts.get("7"),
    )
    require(
        nuts.get("9", {}).get("supported") is True,
        "NUT-09 must be supported",
        nuts.get("9"),
    )
    require("13" not in nuts, "NUT-13 must not be mint-advertised", nuts.get("13"))

    subscriptions = nuts.get("17", {}).get("supported", [])
    commands = next(
        (
            set(entry.get("commands", []))
            for entry in subscriptions
            if entry.get("method") == "bolt11" and entry.get("unit") == "usd"
        ),
        set(),
    )
    require(
        {"bolt11_mint_quote", "bolt11_melt_quote", "proof_state"} <= commands,
        "NUT-17 USD subscription commands are incomplete",
        commands,
    )

    cache = nuts.get("19", {})
    require(cache.get("ttl") == 3600, "NUT-19 TTL must be 3600", cache)
    cached_endpoints = {
        (entry.get("method"), entry.get("path"))
        for entry in cache.get("cached_endpoints", [])
    }
    require(
        ("POST", "/v1/mint/bolt11") in cached_endpoints,
        "NUT-19 mint endpoint is missing",
        cache,
    )
    require(
        ("POST", "/v1/melt/bolt11") in cached_endpoints,
        "NUT-19 melt endpoint is missing",
        cache,
    )


def main() -> None:
    with urllib.request.urlopen(sys.argv[1], timeout=5) as response:
        info = json.load(response)
    validate(info)
    print("nutshell reference ready: Nutshell/0.20.3 bolt11/USD")


if __name__ == "__main__":
    main()
