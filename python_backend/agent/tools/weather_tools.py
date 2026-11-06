"""Weather tools using Open-Meteo (free, no API key needed)."""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import aiohttp

from utils.logger import get_logger

logger = get_logger(__name__)

# ── WMO Weather Code → Human-Readable Condition ───────────────────────────

WMO_CODES: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

TYPO_MAP: Dict[str, str] = {
    "pares": "Paris",
    "pari": "Paris",
    "londn": "London",
    "tokio": "Tokyo",
    "newyork": "New York",
    "nyc": "New York",
    "berln": "Berlin",
    "sidney": "Sydney",
    "mumbay": "Mumbai",
    "singapor": "Singapore",
    "chocago": "Chicago",
    "sanfransisco": "San Francisco",
    "san fran": "San Francisco",
    "sf": "San Francisco",
    "la": "Los Angeles",
    "current location": "Paris",
    "here": "Paris",
    "my location": "Paris",
}


def _get_condition(code: int) -> str:
    return WMO_CODES.get(code, "Variable weather")


def _c_to_f(celsius: float) -> int:
    return round((celsius * 9) / 5 + 32)


def _sanitize_location(raw: str) -> str:
    import re
    cleaned = (raw or "").strip()
    cleaned = re.sub(r"[?!.,]", "", cleaned)
    cleaned = re.sub(r"^(the|a|an|in|at|for|around|of|near)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\s+(right now|currently|today|tomorrow|tonight|this week|now|weather|forecast|please|city|area)$",
        "", cleaned, flags=re.IGNORECASE
    )
    cleaned = cleaned.strip()
    lower = cleaned.lower()
    if lower in TYPO_MAP:
        cleaned = TYPO_MAP[lower]
    return cleaned


# Geocodes never change and forecasts change slowly — cache both so a repeat question
# answers instantly instead of blocking a live voice turn on the network.
_GEO_CACHE: Dict[str, Dict[str, Any]] = {}
_FORECAST_CACHE: Dict[str, Any] = {}
_FORECAST_TTL_S = 600
_HTTP_TIMEOUT = aiohttp.ClientTimeout(total=5)

# One pooled session per event loop: keep-alive means repeat lookups skip the TLS
# handshake (~1.7 s per new connection on slow networks).
_SESSION: Optional[aiohttp.ClientSession] = None
_SESSION_LOOP: Any = None


def _shared_session() -> aiohttp.ClientSession:
    global _SESSION, _SESSION_LOOP
    loop = asyncio.get_running_loop()
    if _SESSION is None or _SESSION.closed or _SESSION_LOOP is not loop:
        _SESSION = aiohttp.ClientSession(connector=aiohttp.TCPConnector(keepalive_timeout=60, limit=8))
        _SESSION_LOOP = loop
    return _SESSION


async def close_shared_session() -> None:
    global _SESSION
    if _SESSION is not None and not _SESSION.closed:
        await _SESSION.close()
    _SESSION = None


class _BorrowedSession:
    async def __aenter__(self) -> aiohttp.ClientSession:
        return _shared_session()

    async def __aexit__(self, *exc: Any) -> None:
        return None


async def _geocode(session: aiohttp.ClientSession, location_query: str) -> Optional[Dict[str, Any]]:
    """Call Open-Meteo Geocoding API (cached)."""
    cache_key = location_query.strip().lower()
    if cache_key in _GEO_CACHE:
        return _GEO_CACHE[cache_key]
    candidates = [
        _sanitize_location(location_query),
        location_query.strip().replace("?!.,", ""),
        location_query.split()[0] if location_query.split() else location_query,
    ]
    seen: set = set()
    for name in candidates:
        key = name.lower()
        if key in seen or not name:
            continue
        seen.add(key)
        try:
            from urllib.parse import quote
            geo_url = (
                "https://geocoding-api.open-meteo.com/v1/search"
                f"?name={quote(name)}&count=5&language=en&format=json"
            )
            async with session.get(geo_url, timeout=_HTTP_TIMEOUT) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = data.get("results", [])
                    if results:
                        results.sort(key=lambda r: r.get("population", 0), reverse=True)
                        _GEO_CACHE[cache_key] = results[0]
                        return results[0]
        except Exception as exc:
            logger.debug("Geocode error for %s: %s", name, exc)
            continue
    return None


async def predict_weather(location: str, days: int = 3) -> Dict[str, Any]:
    """Fetch live weather for a city using Open-Meteo (free, no key needed).

    Returns a dict with keys: success, message, data (or error).
    """
    location_query = (location or "").strip()
    if not location_query:
        return {
            "success": False,
            "error": "Location is required",
            "message": "Please provide a city or location name to check the weather.",
        }

    forecast_days = max(1, min(int(days or 3), 7))
    import time as _time
    fkey = f"{location_query.lower()}|{forecast_days}"
    cached = _FORECAST_CACHE.get(fkey)
    if cached and _time.monotonic() - cached[0] < _FORECAST_TTL_S:
        return cached[1]

    result = await _race_providers(location_query, forecast_days)
    if result.get("success"):
        _FORECAST_CACHE[fkey] = (_time.monotonic(), result)
    return result


async def _race_providers(location_query: str, forecast_days: int) -> Dict[str, Any]:
    """Ask Open-Meteo and wttr.in at once; the first good answer wins.

    A voice turn is blocked while this runs, so one slow provider shouldn't mean silence.
    """
    tasks = {
        asyncio.create_task(_predict_weather_uncached(location_query, forecast_days)),
        asyncio.create_task(_wttr_weather(location_query, forecast_days)),
    }
    last: Optional[Dict[str, Any]] = None
    try:
        while tasks:
            done, tasks = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                try:
                    res = t.result()
                except Exception as exc:  # noqa: BLE001
                    res = {"success": False, "error": str(exc), "message": f"Weather lookup failed: {exc}"}
                if res.get("success"):
                    return res
                last = res
    finally:
        for t in tasks:
            t.cancel()
    return last or {"success": False, "error": "unavailable", "message": f'Could not get the weather for "{location_query}" right now.'}


async def _wttr_weather(location_query: str, forecast_days: int) -> Dict[str, Any]:
    """Backup provider: wttr.in JSON (single request, no separate geocoding step)."""
    from urllib.parse import quote

    session = _shared_session()
    url = f"https://wttr.in/{quote(_sanitize_location(location_query))}?format=j1"
    async with session.get(url, timeout=_HTTP_TIMEOUT, headers={"User-Agent": "curl/8"}) as resp:
        if resp.status != 200:
            return {"success": False, "error": f"wttr.in HTTP {resp.status}", "message": "Weather backup unavailable."}
        data = await resp.json(content_type=None)
    cur = (data.get("current_condition") or [{}])[0]
    area = (data.get("nearest_area") or [{}])[0]
    # wttr.in reports the nearest weather-station neighbourhood (e.g. "Sowcarpet" for
    # Chennai) — keep the place name the user actually asked about.
    name = ", ".join(filter(None, [
        _sanitize_location(location_query).title(),
        ((area.get("region") or [{}])[0]).get("value"),
        ((area.get("country") or [{}])[0]).get("value"),
    ])) or location_query
    cond = ((cur.get("weatherDesc") or [{}])[0]).get("value", "").strip() or "Unknown"
    t_c, fl_c = int(cur.get("temp_C", 0)), int(cur.get("FeelsLikeC", 0))
    lines = []
    for idx, day in enumerate((data.get("weather") or [])[:forecast_days]):
        label = "Today" if idx == 0 else "Tomorrow" if idx == 1 else f"Day {idx + 1} ({day.get('date')})"
        hourly = day.get("hourly") or []
        rain = max((int(h.get("chanceofrain", 0) or 0) for h in hourly), default=0)
        mid = hourly[len(hourly) // 2] if hourly else {}
        dcond = ((mid.get("weatherDesc") or [{}])[0]).get("value", cond).strip()
        hi, lo = int(day.get("maxtempC", 0)), int(day.get("mintempC", 0))
        lines.append(f"• {label}: {dcond}, High {hi}°C ({_c_to_f(hi)}°F) / Low {lo}°C ({_c_to_f(lo)}°F), {rain}% chance of rain.")
    message = (
        f"Weather forecast for {name}:\n"
        f"Currently: {cond}, {t_c}°C ({_c_to_f(t_c)}°F), feels like {fl_c}°C ({_c_to_f(fl_c)}°F). "
        f"Humidity: {cur.get('humidity', '?')}%, Wind: {cur.get('windspeedKmph', '?')} km/h.\n"
        "Predictions:\n" + "\n".join(lines)
    )
    return {"success": True, "message": message, "data": {"location": name, "source": "wttr.in"}}


async def _predict_weather_uncached(location_query: str, forecast_days: int) -> Dict[str, Any]:
    try:
        async with _BorrowedSession() as session:
            loc = await _geocode(session, location_query)
            if not loc:
                return {
                    "success": False,
                    "error": f'Location "{location_query}" not found.',
                    "message": f'Could not locate "{location_query}". Please verify the city or location name.',
                }

            location_name = ", ".join(filter(None, [loc.get("name"), loc.get("admin1"), loc.get("country")]))
            lat, lon = loc["latitude"], loc["longitude"]

            weather_url = (
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={lat}&longitude={lon}"
                f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
                f"&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max"
                f"&timezone=auto&forecast_days={forecast_days}"
            )

            async with session.get(weather_url, timeout=_HTTP_TIMEOUT) as resp:
                if resp.status != 200:
                    return {
                        "success": False,
                        "error": "Weather data unavailable",
                        "message": f"Could not retrieve weather data for {location_name}.",
                    }
                weather_data = await resp.json()

            current = weather_data.get("current", {})
            daily = weather_data.get("daily", {})

            if not current or not daily:
                return {
                    "success": False,
                    "error": "Weather data unavailable",
                    "message": f"Could not retrieve weather forecast for {location_name}.",
                }

            cur_temp_c = round(current.get("temperature_2m", 0))
            cur_temp_f = _c_to_f(current.get("temperature_2m", 0))
            feels_like_c = round(current.get("apparent_temperature", 0))
            feels_like_f = _c_to_f(current.get("apparent_temperature", 0))
            cur_condition = _get_condition(current.get("weather_code", 0))
            humidity = current.get("relative_humidity_2m", 0)
            wind_speed = round(current.get("wind_speed_10m", 0))

            forecast_list = []
            times = daily.get("time", [])
            for i, date_str in enumerate(times):
                max_c = round(daily.get("temperature_2m_max", [0])[i])
                min_c = round(daily.get("temperature_2m_min", [0])[i])
                cond = _get_condition((daily.get("weather_code") or [0])[i])
                rain_prob = (daily.get("precipitation_probability_max") or [0])[i] or 0
                rain_sum = (daily.get("precipitation_sum") or [0])[i] or 0
                forecast_list.append({
                    "date": date_str,
                    "condition": cond,
                    "tempMaxC": max_c,
                    "tempMaxF": _c_to_f(max_c),
                    "tempMinC": min_c,
                    "tempMinF": _c_to_f(min_c),
                    "precipitationChance": rain_prob,
                    "precipitationMm": rain_sum,
                })

            forecast_lines = []
            for idx, f in enumerate(forecast_list):
                if idx == 0:
                    label = "Today"
                elif idx == 1:
                    label = "Tomorrow"
                else:
                    label = f"Day {idx + 1} ({f['date']})"
                forecast_lines.append(
                    f"• {label}: {f['condition']}, High {f['tempMaxC']}°C ({f['tempMaxF']}°F) "
                    f"/ Low {f['tempMinC']}°C ({f['tempMinF']}°F), {f['precipitationChance']}% chance of precipitation."
                )

            readable_summary = (
                f"Weather forecast for {location_name}:\n"
                f"Currently: {cur_condition}, {cur_temp_c}°C ({cur_temp_f}°F), "
                f"feels like {feels_like_c}°C ({feels_like_f}°F). "
                f"Humidity: {humidity}%, Wind: {wind_speed} km/h.\n"
                f"Predictions:\n" + "\n".join(forecast_lines)
            )

            return {
                "success": True,
                "message": readable_summary,
                "data": {
                    "location": location_name,
                    "coordinates": {"latitude": lat, "longitude": lon},
                    "current": {
                        "condition": cur_condition,
                        "temperatureC": cur_temp_c,
                        "temperatureF": cur_temp_f,
                        "feelsLikeC": feels_like_c,
                        "feelsLikeF": feels_like_f,
                        "humidity": humidity,
                        "windSpeedKmH": wind_speed,
                    },
                    "forecast": forecast_list,
                },
            }

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Weather tool error for '%s': %s", location_query, exc)
        return {
            "success": False,
            "error": str(exc),
            "message": f'Failed to fetch weather forecast for "{location_query}": {exc}',
        }


# Alias get_weather -> predict_weather
get_weather = predict_weather

