package com.apibench;

import at.favre.lib.crypto.bcrypt.BCrypt;

public final class BcryptUtil {

    public static String hash(String password) {
        return BCrypt.withDefaults().hashToString(10, password.toCharArray());
    }

    public static boolean verify(String password, String hash) {
        return BCrypt.verifyer().verify(password.toCharArray(), hash).verified;
    }
}
