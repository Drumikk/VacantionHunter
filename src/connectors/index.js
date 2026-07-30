import { demoConnector } from "./demo.js";
import { hhConnector } from "./hh.js";
import { hhEmailConnector } from "./hh-email.js";
import { remotiveConnector } from "./remotive.js";
import { arbeitnowConnector } from "./arbeitnow.js";
import { joobleConnector } from "./jooble.js";
import { usajobsConnector } from "./usajobs.js";
import { greenhouseConnectors } from "./greenhouse.js";
import { ashbyConnectors } from "./ashby.js";
import { leverConnectors } from "./lever.js";
import { restrictedConnectors } from "./restricted.js";
import { trudvsemConnector } from "./trudvsem.js";
import { jobtechConnector } from "./jobtech.js";
import { remoteOkConnector } from "./remoteok.js";
import { weWorkRemotelyConnector } from "./weworkremotely.js";
import { hnWhoIsHiringConnector } from "./hn-who-is-hiring.js";
import { reliefWebConnector } from "./reliefweb.js";
import { recruiteeConnectors } from "./recruitee.js";
import { adzunaConnectors } from "./adzuna.js";

export function createConnectors(config) {
  const connectors = config.enableDemoSource === false ? [] : [demoConnector(config.demoPath)];
  if (config.enableLiveSources) {
    connectors.push(
      hhEmailConnector(config), hhConnector(config), joobleConnector(config), usajobsConnector(config), remotiveConnector(config), arbeitnowConnector(config),
      trudvsemConnector(config), jobtechConnector(config), remoteOkConnector(config), weWorkRemotelyConnector(config), hnWhoIsHiringConnector(config), reliefWebConnector(config),
      ...restrictedConnectors(), ...greenhouseConnectors(config), ...ashbyConnectors(config), ...leverConnectors(config), ...recruiteeConnectors(config), ...adzunaConnectors(config),
    );
  }
  return connectors;
}
