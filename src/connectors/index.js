import { demoConnector } from "./demo.js";
import { hhConnector } from "./hh.js";
import { remotiveConnector } from "./remotive.js";
import { arbeitnowConnector } from "./arbeitnow.js";
import { joobleConnector } from "./jooble.js";
import { usajobsConnector } from "./usajobs.js";
import { greenhouseConnectors } from "./greenhouse.js";
import { ashbyConnectors } from "./ashby.js";
import { leverConnectors } from "./lever.js";

export function createConnectors(config) {
  const connectors = [demoConnector(config.demoPath)];
  if (config.enableLiveSources) connectors.push(hhConnector(config), joobleConnector(config), usajobsConnector(config), remotiveConnector(config), arbeitnowConnector(config));
  connectors.push(...greenhouseConnectors(config), ...ashbyConnectors(config), ...leverConnectors(config));
  return connectors;
}
