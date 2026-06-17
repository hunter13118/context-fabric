import type { Connector } from "./types.js";
import { salesforceConnector } from "./salesforce.js";
import { slackConnector } from "./slack.js";
import { jiraConnector } from "./jira.js";
import { githubConnector } from "./github.js";
import { servicenowConnector } from "./servicenow.js";
import { calendarConnector } from "./calendar.js";
import { emailConnector } from "./email.js";

export const connectors: Record<string, Connector<any>> = {
  salesforce: salesforceConnector,
  slack: slackConnector,
  jira: jiraConnector,
  github: githubConnector,
  servicenow: servicenowConnector,
  calendar: calendarConnector,
  email: emailConnector,
};

export {
  salesforceConnector, slackConnector, jiraConnector, githubConnector,
  servicenowConnector, calendarConnector, emailConnector,
};
export * from "./types.js";
