plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.codearts.bar"
val rootPackageJson = groovy.json.JsonSlurper().parse(file("../package.json")) as Map<*, *>
version = rootPackageJson["version"].toString()

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
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

val prepareEmbeddedCli by tasks.registering(Exec::class) {
    workingDir = file("..")
    commandLine("node", "src/build-cli-resources.js")
    inputs.files(fileTree("../src") { include("**/*.js", "**/*.json") })
    outputs.dir(file("../.cache/cli-runtime"))
}

val copyEmbeddedCli by tasks.registering(Copy::class) {
    dependsOn(prepareEmbeddedCli)
    from("../.cache/cli-runtime")
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
