import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "fs/promises";
import { parse } from "date-fns";
import { IncomingWebhook } from "@slack/webhook";

interface Stats {
  passed: number;
  failed: number;
  skipped: number;
  successRate: number;
  timestamp: number;
}

class RobotFrameworkResultsToSlack {
  public readonly outputXmlPath: string = core.getInput("output_xml_path", {
    required: true,
  });
  public readonly slackWebhookUrl: string = core.getInput("slack_webhook_url", {
    required: true,
  });
  public readonly slackChannel: string = core.getInput("slack_channel", {
    required: true,
  });
  public readonly slackUsername: string = core.getInput("slack_username", {
    required: false,
  });
  public readonly slackIcon: string = core.getInput("slack_icon", {
    required: false,
  });
  public readonly slackHeader: string = core.getInput("slack_header", {
    required: false,
  });
  public readonly alertChannelOnFailure: boolean =
    core.getInput("alert_channel_on_failure", { required: false }) === "true";
  public readonly alertChannelOnSkipped: boolean =
    core.getInput("alert_channel_on_skipped", { required: false }) === "true";
  public readonly alertChannelOnSuccess: boolean =
    core.getInput("alert_channel_on_success", { required: false }) === "true";
  public readonly alertChannelOnNoOutput: boolean =
    core.getInput("alert_channel_on_no_output", { required: false }) === "true";
  public readonly noOutputFoundMessage: string = core.getInput(
    "no_output_found_message",
    { required: false }
  );

  public async run(): Promise<void> {
    core.info("Running Robot Framework Results To Slack");

    const resultsXml = await this.getResults();

    if (!resultsXml) {
      if (this.alertChannelOnNoOutput) {
        await this.sendSlackMessage(this.noOutputFoundMessage);
      }
      return;
    }

    try {
      const stats = this.getStats(resultsXml);
      if (!stats) {
        core.setFailed("Error getting stats from XML");
        return;
      }
      await this.sendStats(stats);
    } catch (error: any) {
      core.setFailed(error.message);
      return;
    }
  }

  private async getResults(): Promise<string | undefined> {
    try {
      const results = await readFile(this.outputXmlPath, "utf8");
      return results;
    } catch (error) {
      core.error(`Error reading results file: ${error}`);
      return;
    }
  }

  private getStats(resultsXml: string): Stats | undefined {
    const line = resultsXml.match(/<stat[^>]+>All Tests<\/stat>/);
    if (!line) {
      core.error("Error getting stats from XML");
      return;
    }

    const getArg = (arg: string): string => {
      const regex = new RegExp(`(?<=${arg}=\")[^\\s]+(?=\")`);
      const match = line[0].match(regex);
      if (!match) {
        core.error(`Error getting ${arg} from XML`);
        throw new Error(`Error getting ${arg} from XML`);
      }
      return match[0];
    };

    const passed = parseInt(getArg("pass"));
    const failed = parseInt(getArg("fail"));
    const skipped = parseInt(getArg("skip"));
    const successRate = parseInt(
      ((passed / (passed + failed + skipped)) * 100).toFixed(1)
    );

    const generated =
      resultsXml.match(/(?<=generated=\")[^\"]+(?=\")/)?.toString() || "";
    const timestamp = parse(
      generated,
      "yyyyMMdd HH:mm:ss.SSS",
      new Date()
    ).getTime();

    return {
      passed,
      failed,
      skipped,
      successRate,
      timestamp,
    };
  }

  private getColor(stats: Stats): string {
    if (stats.successRate === 100) return "#2EB67D";
    if (stats.successRate > 80) return "#ECB22E";
    return "#E01E5A";
  }

  private async sendStats(stats: Stats): Promise<void> {
    const attachments = [
      {
        color: this.getColor(stats),
        text: this.slackHeader,
        mrkdwn_in: ["text", "fields"],
        ts: stats.timestamp,
        fields: [
          {
            title: "*Passed:*",
            value: stats.passed.toString(),
            short: true,
          },
          {
            title: "*Failed:*",
            value: stats.failed.toString(),
            short: true,
          },
          {
            title: "*Skipped:*",
            value: stats.skipped.toString(),
            short: true,
          },
          {
            title: "*Success Rate:*",
            value: `${stats.successRate}%`,
            short: true,
          },
        ],
      },
    ];

    await this.sendSlackMessage(
      `Robot Test Results #${github.context.runNumber}`,
      attachments
    );
  }

  private async sendSlackMessage(
    message: string,
    attachments: any = []
  ): Promise<void> {
    const webhook = new IncomingWebhook(this.slackWebhookUrl);
    await webhook.send({
      channel: this.slackChannel,
      username: this.slackUsername,
      icon_emoji: this.slackIcon,
      text: message,
      attachments,
    });
  }
}

const robotFrameworkResultsToSlack = new RobotFrameworkResultsToSlack();

robotFrameworkResultsToSlack.run();
