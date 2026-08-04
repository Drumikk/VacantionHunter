import { demoConnector } from "./demo.js";
import { hhConnector } from "./hh.js";
import { hhEmailConnector } from "./hh-email.js";
import { remotiveConnector } from "./remotive.js";
import { arbeitnowConnector } from "./arbeitnow.js";
import { joobleConnector } from "./jooble.js";
import { usajobsConnector } from "./usajobs.js";
import { careerOneStopConnector } from "./careeronestop.js";
import { navConnector } from "./nav.js";
import { jobMarketFinlandConnector } from "./job-market-finland.js";
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
import { himalayasConnector } from "./himalayas.js";
import { jobicyConnector } from "./jobicy.js";
import { reedConnector } from "./reed.js";
import { superJobConnector } from "./superjob.js";
import { workableConnectors } from "./workable.js";
import { franceTravailConnector } from "./france-travail.js";
import { theMuseConnector } from "./the-muse.js";
import { personioConnectors } from "./personio.js";
import { smartRecruitersConnectors } from "./smartrecruiters.js";

export function createConnectors(config) {
  const connectors = config.enableDemoSource === false ? [] : [demoConnector(config.demoPath)];
  if (config.enableLiveSources) {
    connectors.push(
      hhEmailConnector(config), hhConnector(config), joobleConnector(config), usajobsConnector(config), careerOneStopConnector(config), navConnector(config), jobMarketFinlandConnector(config), remotiveConnector(config), arbeitnowConnector(config),
      trudvsemConnector(config), jobtechConnector(config), remoteOkConnector(config), weWorkRemotelyConnector(config), hnWhoIsHiringConnector(config), reliefWebConnector(config),
      himalayasConnector(config), jobicyConnector(config), reedConnector(config), superJobConnector(config), franceTravailConnector(config), theMuseConnector(config),
      ...restrictedConnectors(), ...greenhouseConnectors(config), ...ashbyConnectors(config), ...leverConnectors(config), ...recruiteeConnectors(config), ...workableConnectors(config), ...personioConnectors(config), ...smartRecruitersConnectors(config), ...adzunaConnectors(config),
    );
  }
  return connectors;
}
