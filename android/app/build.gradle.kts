import java.io.File

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.choutify.choutify"
    // permission_handler_android exige la compilation contre l'API 37.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
                applicationId = "com.choutify.choutify"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Signature de release : fournie par la CI via des variables
    // d'environnement (voir .github/workflows/release.yml). Sans elles, on
    // signe avec la clé de debug (builds locaux).
    val keystorePath = System.getenv("CHOUTIFY_KEYSTORE_PATH")
    val hasReleaseKey = keystorePath != null && File(keystorePath).exists()
    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = File(keystorePath!!)
                storePassword = System.getenv("CHOUTIFY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CHOUTIFY_KEY_ALIAS") ?: "choutify"
                keyPassword = System.getenv("CHOUTIFY_KEY_PASSWORD")
                    ?: System.getenv("CHOUTIFY_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
