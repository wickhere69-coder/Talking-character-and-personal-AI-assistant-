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


async def _geocode(session: aiohttp.ClientSession, location_query: str) -> Optional[Dict[str, Any]]:
    """Call Open-Meteo Geocoding API."""
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
            async with session.get(geo_url, timeout=aiohttp.ClientTimeout(total=6)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = data.get("results", [])
                    if results:
                        results.sort(key=lambda r: r.get("population", 0), reverse=True)
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

    try:
        async with aiohttp.ClientSession() as session:
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

            async with session.get(weather_url, timeout=aiohttp.ClientTimeout(total=6)) as resp:
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

