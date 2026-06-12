export interface IkusaLoggerInstallStep {
  platform: "Windows" | "Linux";
  prerequisites: string[];
  buildCommand: string;
  startCommand: string;
}

export interface IkusaCombatLogUpload {
  guildId: string;
  warId?: string;
  recordedAt: string;
  fileName: string;
  source: "ikusa-logger";
}

export const ikusaLogger = {
  name: "Ikusa Logger",
  description: "Open-source Black Desert Online network sniffer for recording combat events during Node Wars.",
  repositoryUrl: "https://github.com/sch-28/ikusa_logger",
  installUrl: "https://github.com/sch-28/ikusa_logger?tab=readme-ov-file#installation",
  visualizerUrl: "https://github.com/sch-28/ikusa",
  install: [
    {
      platform: "Windows",
      prerequisites: ["Npcap 1.7.8", "Node.js 16+", "Python 3+ added to PATH"],
      buildCommand: "build.bat",
      startCommand: "dist/ikusa-logger/ikusa-logger-win_x64.exe",
    },
    {
      platform: "Linux",
      prerequisites: ["nodejs", "libcap", "python3", "patchelf"],
      buildCommand: "build.sh",
      startCommand: "start.sh",
    },
  ] satisfies IkusaLoggerInstallStep[],
} as const;
