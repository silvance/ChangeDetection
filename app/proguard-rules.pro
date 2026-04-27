# Add project specific ProGuard rules here.

# Keep useful stack traces in crashlytics-style logs.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Gomobile / tscmlib (Go-compiled AAR)
# Gobind classes are accessed via JNI; R8 must not rename or strip them.
# ---------------------------------------------------------------------------
-keep class go.** { *; }
-keep class tscmlib.** { *; }
-keepclassmembers class tscmlib.** { *; }
-dontwarn go.**
-dontwarn tscmlib.**

# ---------------------------------------------------------------------------
# Kotlin coroutines / reflection bits used by StateFlow + ViewModel
# ---------------------------------------------------------------------------
-keepclassmembernames class kotlinx.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.debug.**

# ---------------------------------------------------------------------------
# CameraX
# ---------------------------------------------------------------------------
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# ---------------------------------------------------------------------------
# AndroidX Navigation, Lifecycle, Material — covered by their consumer rules,
# but keep generated databinding bridges for view binding lookups.
# ---------------------------------------------------------------------------
-keep class com.tscm.changedetection.databinding.** { *; }
