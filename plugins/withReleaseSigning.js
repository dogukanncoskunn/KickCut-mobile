const { withAppBuildGradle } = require("expo/config-plugins");

/*
 * Signs release builds with the project's own key when this machine has it.
 *
 * The key and its passwords never live in the repo. They come from Gradle
 * properties - normally ~/.gradle/gradle.properties:
 *
 *   KICKCUT_RELEASE_STORE_FILE=C:/Users/<you>/.android/kickcut-release.jks
 *   KICKCUT_RELEASE_STORE_PASSWORD=...
 *   KICKCUT_RELEASE_KEY_ALIAS=kickcut
 *   KICKCUT_RELEASE_KEY_PASSWORD=...
 *
 * Without them (CI, a fresh clone) the release build keeps the template's
 * debug signing, so it still builds; it just cannot update an installed copy
 * signed with the real key.
 */
const MARKER = "// kickcut: release signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARKER}
        if (project.hasProperty("KICKCUT_RELEASE_STORE_FILE")) {
            release {
                storeFile file(project.property("KICKCUT_RELEASE_STORE_FILE"))
                storePassword project.property("KICKCUT_RELEASE_STORE_PASSWORD")
                keyAlias project.property("KICKCUT_RELEASE_KEY_ALIAS")
                keyPassword project.property("KICKCUT_RELEASE_KEY_PASSWORD")
            }
        }`,
    );

    // In the release build type, prefer the real key when it was configured.
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig project.hasProperty("KICKCUT_RELEASE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug`,
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
