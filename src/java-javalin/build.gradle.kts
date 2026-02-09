plugins {
    java
    application
    id("com.gradleup.shadow") version "9.0.0"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.javalin:javalin:6.7.0")
    implementation("org.slf4j:slf4j-simple:2.0.16")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.18.2")
    implementation("com.zaxxer:HikariCP:6.2.1")
    implementation("org.postgresql:postgresql:42.7.5")
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")
    implementation("at.favre.lib:bcrypt:0.10.2")
}

application {
    mainClass.set("com.apibench.App")
}

tasks.shadowJar {
    archiveBaseName.set("java-javalin")
    archiveClassifier.set("all")
    archiveVersion.set("")
    mergeServiceFiles()
}
