# Third-party components

- usb-serial-for-android v3.9.0, commit `e1018ab31c118b7d2e15fc7c2e9c5b19f33eb1f1`.
  Source: https://github.com/mik3y/usb-serial-for-android/tree/v3.9.0/usbSerialForAndroid/src/main/java
  Vendored under app/src/main/java/com/hoho/android/usbserial. MIT license retained in usb-serial-LICENSE.txt and original source headers. A local BuildConfig.java disables library debug logs; driver sources are otherwise unchanged.
- AndroidX Annotation 1.3.0, compile-only jar under app/libs. Apache License 2.0, see Apache-2.0.txt.
  Source: https://developer.android.com/jetpack/androidx/releases/annotation
  Binary: https://dl.google.com/dl/android/maven2/androidx/annotation/annotation/1.3.0/annotation-1.3.0.jar
  The annotations are not bundled in the APK.
- Gradle 8.9 wrapper, source scripts/jar from https://github.com/gradle/gradle/tree/v8.9.0 . Apache License 2.0. Distribution SHA-256 is pinned to Gradle's published checksum.

Android SDK and JDK are build prerequisites, not redistributed in the source package.
