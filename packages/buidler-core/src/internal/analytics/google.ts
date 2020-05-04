import AbortController from "abort-controller";
import debug from "debug";
import fetch from "node-fetch";
import qs from "qs";

import { UserType } from "./analytics";
import { AbortAnalytics, AnalyticsClient } from "./client";

// VERY IMPORTANT:
// The documentation doesn't say so, but the user-agent parameter is required (ua).
// If you don't send it, you won't get an error or anything, Google will *silently* drop your hit.
//
// https://stackoverflow.com/questions/27357954/google-analytics-measurement-protocol-not-working
interface RawAnalytics {
  v: "1";
  tid: string;
  cid: string;
  dp: string;
  dh: string;
  t: string;
  ua: string;
  cs: string;
  cm: string;
  cd1: string;
  cd2: string;
  cd3: string;
}

const googleAnalyticsUrl = "https://www.google-analytics.com/collect";

const log = debug("buidler:core:analytics:google");

export class GoogleAnalytics extends AnalyticsClient {
  private readonly _projectId: string;
  private readonly _clientId: string;
  private readonly _userType: UserType;

  private readonly _buidlerVersion: string;
  private readonly _userAgent: string;

  // Buidler's tracking id. I guess there's no other choice than keeping it here.
  private readonly _trackingId: string = "UA-117668706-3";

  constructor(
    projectId: string,
    clientId: string,
    userType: UserType,
    userAgent: string,
    buidlerVersion: string
  ) {
    super();
    this._projectId = projectId;
    this._clientId = clientId;
    this._userType = userType;
    this._userAgent = userAgent;
    this._buidlerVersion = buidlerVersion;
  }

  /**
   * Attempt to send a hit to Google Analytics using the Measurement Protocol.
   * This function returns immediately after starting the request, returning a function for aborting it.
   * The idea is that we don't want Buidler tasks to be slowed down by a slow network request, so
   * Buidler can abort the request if it takes too much time.
   *
   * Trying to abort a successfully completed request is a no-op, so it's always safe to call it.
   *
   * @param taskKind The name of the task to be logged
   * @param name The task name (unused)
   *
   * @returns The abort function
   */
  public sendTaskHit(
    taskKind: "builtin" | "custom",
    name: string
  ): [AbortAnalytics, Promise<void>] {
    const taskHit = this._taskHit(taskKind);
    return this._sendHit(taskHit);
  }

  public async sendErrorReport() {
    // no error report for google analytics client
    return;
  }

  private _taskHit(taskKind: "builtin" | "custom"): RawAnalytics {
    return {
      // Measurement protocol version.
      v: "1",

      // Hit type, we're only using pageviews for now.
      t: "pageview",

      // Buidler's tracking Id.
      tid: this._trackingId,

      // Client Id.
      cid: this._clientId,

      // Document path, must start with a '/'.
      dp: `/task/${taskKind}`,

      // Host name.
      dh: "cli.buidler.dev",

      // User agent, must be present.
      // We use it to inform Node version used and OS.
      // Example:
      //   Node/v8.12.0 (Darwin 17.7.0)
      ua: this._userAgent,

      // We're using the following values (Campaign source, Campaign medium) to track
      // whether the user is a Developer or CI, as Custom Dimensions are not working for us atm.
      cs: this._userType,
      cm: "User Type",

      // We're using custom dimensions for tracking different user projects, and user types (Developer/CI).
      //
      // See the following link for docs on these paremeters:
      // https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters#pr_cd_
      //
      // See the following link for setting up our custom dimensions in the Google Analytics dashboard
      // https://support.google.com/tagmanager/answer/6164990
      //
      // Custom dimension 1: Project Id
      // This is computed as the keccak256 hash of the project's absolute path.
      cd1: this._projectId,
      // Custom dimension 2: User type
      //   Possible values: "CI", "Developer".
      cd2: this._userType,
      // Custom dimension 3: Buidler Version
      //   Example: "Buidler 1.0.0".
      cd3: this._buidlerVersion
    };
  }

  private _sendHit(hit: RawAnalytics): [AbortAnalytics, Promise<void>] {
    log(`Sending hit for ${hit.dp}`);

    const controller = new AbortController();

    const abortAnalytics = () => {
      log(`Aborting hit for ${JSON.stringify(hit.dp)}`);

      controller.abort();
    };

    const hitPayload = qs.stringify(hit);

    log(`Hit payload: ${JSON.stringify(hit)}`);

    const hitPromise = fetch(googleAnalyticsUrl, {
      body: hitPayload,
      method: "POST",
      signal: controller.signal
    })
      .then(() => {
        log(`Hit for ${JSON.stringify(hit.dp)} sent successfully`);
      })
      // We're not really interested in handling failed analytics requests
      .catch(() => {
        log("Hit request failed");
      });

    return [abortAnalytics, hitPromise];
  }
}
