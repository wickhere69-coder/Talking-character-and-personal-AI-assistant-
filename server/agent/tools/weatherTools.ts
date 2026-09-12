import axios from 'axios';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

/**
 * Maps WMO Weather Interpretation Codes to friendly descriptive strings.
 * Reference: https://open-meteo.com/en/docs
 */
function getWeatherCondition(code: number): string {
  switch (code) {
    case 0:
      return 'Clear sky';
    case 1:
      return 'Mainly clear';
    case 2:
      return 'Partly cloudy';
    case 3:
      return 'Overcast';
    case 45:
      return 'Foggy';
    case 48:
      return 'Depositing rime fog';
    case 51:
      return 'Light drizzle';
    case 53:
      return 'Moderate drizzle';
    case 55:
      return 'Dense drizzle';
    case 56:
      return 'Light freezing drizzle';
    case 57:
      return 'Dense freezing drizzle';
    case 61:
      return 'Slight rain';
    case 63:
      return 'Moderate rain';
    case 65:
      return 'Heavy rain';
    case 66:
      return 'Light freezing rain';
    case 67:
      return 'Heavy freezing rain';
    case 71:
      return 'Slight snow fall';
    case 73:
      return 'Moderate snow fall';
    case 75:
      return 'Heavy snow fall';
    case 77:
      return 'Snow grains';
    case 80:
      return 'Slight rain showers';
    case 81:
      return 'Moderate rain showers';
    case 82:
      return 'Violent rain showers';
    case 85:
      return 'Slight snow showers';
    case 86:
      return 'Heavy snow showers';
    case 95:
      return 'Thunderstorm';
    case 96:
      return 'Thunderstorm with slight hail';
    case 99:
      return 'Thunderstorm with heavy hail';
    default:
      return 'Variable weather';
  }
}

function cToF(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function registerWeatherTools(registry: ToolRegistry): void {
  const weatherHandler = async (params: Record<string, any>): Promise<ToolResult> => {
    const locationQuery = (params.location || params.city || params.query || '').trim();
    if (!locationQuery) {
      return {
        success: false,
        error: 'Location is required',
        message: 'Please provide a city or location name to check and predict the weather.'
      };
    }

    const forecastDays = Math.min(Math.max(Number(params.days) || 3, 1), 7);

    try {
      // 1. Geocoding via Open-Meteo Geocoding API
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationQuery)}&count=1&language=en&format=json`;
      const geoRes = await axios.get(geoUrl, { timeout: 6000 });
      const loc = geoRes.data?.results?.[0];

      if (!loc) {
        return {
          success: false,
          error: `Location "${locationQuery}" not found.`,
          message: `Could not locate "${locationQuery}". Please verify the city or location name.`
        };
      }

      const locationName = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');

      // 2. Fetch live conditions & forecast from Open-Meteo
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=${forecastDays}`;
      const weatherRes = await axios.get(weatherUrl, { timeout: 6000 });
      const current = weatherRes.data?.current;
      const daily = weatherRes.data?.daily;

      if (!current || !daily) {
        return {
          success: false,
          error: 'Weather data unavailable',
          message: `Could not retrieve weather forecast for ${locationName}.`
        };
      }

      const curTempC = Math.round(current.temperature_2m);
      const curTempF = cToF(current.temperature_2m);
      const feelsLikeC = Math.round(current.apparent_temperature);
      const feelsLikeF = cToF(current.apparent_temperature);
      const curCondition = getWeatherCondition(current.weather_code);
      const humidity = current.relative_humidity_2m;
      const windSpeed = Math.round(current.wind_speed_10m);

      // Build daily forecast list
      const forecastDaysList: Array<{
        date: string;
        condition: string;
        tempMaxC: number;
        tempMaxF: number;
        tempMinC: number;
        tempMinF: number;
        precipitationChance: number;
        precipitationMm: number;
      }> = [];

      for (let i = 0; i < (daily.time || []).length; i++) {
        const dateStr = daily.time[i];
        const maxC = Math.round(daily.temperature_2m_max[i]);
        const minC = Math.round(daily.temperature_2m_min[i]);
        const cond = getWeatherCondition(daily.weather_code[i]);
        const rainProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;
        const rainSum = daily.precipitation_sum ? daily.precipitation_sum[i] : 0;

        forecastDaysList.push({
          date: dateStr,
          condition: cond,
          tempMaxC: maxC,
          tempMaxF: cToF(maxC),
          tempMinC: minC,
          tempMinF: cToF(minC),
          precipitationChance: rainProb,
          precipitationMm: rainSum
        });
      }

      // Generate human-readable speech-ready message
      const forecastLines = forecastDaysList.map((f, idx) => {
        const label = idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : `Day ${idx + 1} (${f.date})`;
        return `• ${label}: ${f.condition}, High ${f.tempMaxC}°C (${f.tempMaxF}°F) / Low ${f.tempMinC}°C (${f.tempMinF}°F), ${f.precipitationChance}% chance of precipitation.`;
      });

      const readableSummary = `Weather forecast for ${locationName}:
Currently: ${curCondition}, ${curTempC}°C (${curTempF}°F), feels like ${feelsLikeC}°C (${feelsLikeF}°F). Humidity: ${humidity}%, Wind: ${windSpeed} km/h.
Predictions:
${forecastLines.join('\n')}`;

      return {
        success: true,
        data: {
          location: locationName,
          coordinates: { latitude: loc.latitude, longitude: loc.longitude },
          current: {
            condition: curCondition,
            temperatureC: curTempC,
            temperatureF: curTempF,
            feelsLikeC,
            feelsLikeF,
            humidity,
            windSpeedKmH: windSpeed
          },
          forecast: forecastDaysList
        },
        message: readableSummary
      };
    } catch (err: any) {
      console.error('Weather tool error:', err);
      return {
        success: false,
        error: err.message,
        message: `Failed to fetch weather forecast for "${locationQuery}": ${err.message}`
      };
    }
  };

  // 1. Primary Tool: predict_weather
  registry.registerTool(
    {
      name: 'predict_weather',
      description: 'Predict and forecast real-time weather conditions, temperatures, humidity, wind, and multi-day meteorological forecasts for any city or location.',
      permission: 'READ_ONLY',
      parameters: {
        location: {
          type: 'string',
          description: 'City or location name (e.g., "Paris", "New York", "London", "Tokyo", "Berlin", "San Francisco")',
          required: true
        },
        days: {
          type: 'number',
          description: 'Number of forecast days to predict (1 to 7, default 3)',
          required: false
        }
      }
    },
    weatherHandler
  );

  // 2. Alias Tool: get_weather
  registry.registerTool(
    {
      name: 'get_weather',
      description: 'Get current weather and upcoming forecast for any city or region worldwide.',
      permission: 'READ_ONLY',
      parameters: {
        location: {
          type: 'string',
          description: 'City or location name (e.g. "Paris", "New York", "London")',
          required: true
        },
        days: {
          type: 'number',
          description: 'Number of forecast days (1 to 7)',
          required: false
        }
      }
    },
    weatherHandler
  );
}
