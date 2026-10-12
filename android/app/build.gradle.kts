import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "org.qiskit.fallfest"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.qiskit.fallfest.amaravati"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // Backend URL. Release builds must pass it: ./gradlew assembleRelease -PapiBase=https://your-service.run.app
        val apiBase = providers.gradleProperty("apiBase").orNull
        buildConfigField("String", "API_BASE", "\"${apiBase ?: "https://api.invalid"}\"")
    }

    // Release signing: ~/.qff/keystore.properties (outside the repo) or QFF_KEYSTORE_PROPERTIES env var.
    val ksProps = Properties().apply {
        val f = file(System.getenv("QFF_KEYSTORE_PROPERTIES") ?: "${System.getProperty("user.home")}/.qff/keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    signingConfigs {
        if (ksProps.containsKey("storeFile")) create("event") {
            storeFile = file(ksProps.getProperty("storeFile")); storePassword = ksProps.getProperty("storePassword")
            keyAlias = ksProps.getProperty("keyAlias"); keyPassword = ksProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("event") ?: throw GradleException("Release signing not configured: create ~/.qff/keystore.properties")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    buildTypes.getByName("debug") {
        val apiBase = providers.gradleProperty("apiBase").orNull ?: "http://10.0.2.2:8080" // emulator -> host machine
        buildConfigField("String", "API_BASE", "\"$apiBase\"")
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("Release") && it.name.startsWith("assemble") } && !providers.gradleProperty("apiBase").isPresent)
        throw GradleException("Release builds need -PapiBase=https://<your-cloud-run-url>")
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(bom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("com.google.zxing:core:3.5.3")
}
