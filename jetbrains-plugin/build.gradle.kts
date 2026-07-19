plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.codearts.bar"
val rootPackageJson = groovy.json.JsonSlurper().parse(file("../package.json")) as Map<*, *>
// The launcher always supplies this project property. Keeping the version in
// the Gradle invocation makes it part of the configuration-cache key, so a
// package.json version bump cannot reuse a plugin model from the prior release.
version = providers.gradleProperty("codeartsBarVersion")
    .orElse(rootPackageJson["version"].toString())
    .get()

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        create("IC", providers.gradleProperty("platformVersion")) { }
        pluginVerifier()
        zipSigner()
    }
    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    // IntelliJ's bundled JBR 21 is a complete compiler runtime for this
    // plugin, but Gradle classifies it as a JRE because it has no jmods.
    // Compile against Java 21 directly so local/release builds can use that
    // supported JBR without requiring a separately installed JDK.
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}

val prepareEmbeddedCli by tasks.registering(Exec::class) {
    workingDir = file("..")
    commandLine("node", "src/build-cli-resources.js")
    environment("CODEARTS_BAR_CLI_ENTRY", "src/providers/codearts/jetbrains-cli.js")
    environment("CODEARTS_BAR_CLI_RUNTIME_DIR", file("build/jetbrains-cli-runtime").absolutePath)
    environment("CODEARTS_BAR_CLI_BUNDLE", "1")
    inputs.files(fileTree("../src") { include("**/*.js", "**/*.json") })
    outputs.dir(file("build/jetbrains-cli-runtime"))
}

val copyEmbeddedCli by tasks.registering(Copy::class) {
    dependsOn(prepareEmbeddedCli)
    from("build/jetbrains-cli-runtime")
    into(layout.buildDirectory.dir("generated-resources/cli"))
}

sourceSets.main {
    resources.srcDir(layout.buildDirectory.dir("generated-resources"))
}

tasks.processResources { dependsOn(copyEmbeddedCli) }

tasks {
    patchPluginXml {
        sinceBuild = providers.gradleProperty("pluginSinceBuild")
        untilBuild = providers.gradleProperty("pluginUntilBuild")
    }
    test { useJUnitPlatform() }
}

tasks.withType<org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask>().configureEach {
    // This plugin only depends on bundled platform modules. Offline verifier
    // mode keeps the full IDE compatibility scan while avoiding an unrelated
    // Marketplace metadata request that can fail on restricted networks.
    offline.set(true)
}
