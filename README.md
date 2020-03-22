# R.P. Jeeves

#### Your butler in New Eden

What began as a "quick" day-project exploration into [the ESI](https://esi.evetech.net/) turned into... whatever this is. 

It's messy as can be, but has proven useful & so has been made public in the hope it can be for others.

## Setup

### Prerequisites

`node` version 12 or later

### Installation

In the top-level repository directory (after `clone`):

> `npm install`

## Configuration

### General

`app.`

| Name | Description |
| --- | --- |
| `useSystemOpen` | Use the running system's `open` tool to open the authentication page in default browser (only OS X and Debian-like Linux currently supported) |
| `alwaysUseCachedAuth` | Always use a found cached authorization without prompting |
| `useStaticDataCache` | Use the EVE static data cache; adds *~1.5 gigabytes* to the on-disk footprint, but speeds up many operations significantly |
| `useSimpleAuthResponse` | Fall back to a simple copy/paste authentication flow, for when the redirect server in `http.js` isn't being used |
| `authTimeout` | How long, in minutes, to wait for authentication response from server |

### Character tool

`app.character.` 

| Name | Description |
| --- | --- |
| `autoloadCharacterCard` | Automatically load the character card |
| `minimumCharacterRefresh` | Minimum time, in minutes, to allow character info refreshes |

### Route tool

`app.route.` 

| Name | Description | Values | 
| --- | --- | --- |
| `securityPreference` | Which route security preference to use; adjustable in-app | "shortest", "secure", "insecure" |
| `superDangerThreshold` | The number of pod kills in the last hour required to qualify as "super dangerous"; adjustable in-app | |

### zKillboard lookup

`app.zkb.`
| Name | Description |
| --- | --- |
| `rlDelay` | Rate-limit delay; contrary to documentation, zKB clearly has a rate limit. Leave this as-is unless you know otherwise |
| `lookbackWindow` | How far back - in hours - to query kill data for each solar system |
| `maintainer` | A valid email address to be sent in the `User-Agent` header to zKillboard; their terms of service, not mine |

### Market tool

`app.market.` 

| Name | Description |
| --- | --- |
| `refresh` | Amount of time, in minutes, between market data refreshes (includes watched orders) |
| `rescheduleFailedWork` | Automatically reschedules failed work items |

## Usage

### Authentication
EVE's OAuth2 implementation produces tokens that are valid for 20 minutes. `rpjeeves` will automatically renew it's authentication indefinitely and caches the most-recent token. Hoever if only run infrequently you should expect to need to reauthenticate each time.

### Initial static data setup
Requires at least 1.5 gigabytes of disk space, as it sources the [EVE static data](https://eve-static-data-export.s3-eu-west-1.amazonaws.com/tranquility/sde.zip) bundle, unpacks and parses it into a form used to *significantly* increase application performace.

This process will only be run once on first execution. Use of the cache can be disabled at any time by setting `config.app.useStaticDataCache` to `false`. If this value is `false` at initial execution, no download will take place and will instead occur if/when the feature is enabled.

### Tools

A picture is worth a thousand words, after all. So here's a few thousand:

..

## OAuth redirect server

Found in [`http.js`](http.js), configured via the `http` section & run via `npm run server`, it is a simple & *insecure* stateful OAuth redirect server. But, it does work. Run it behind a reverse proxy such as `nginx`.